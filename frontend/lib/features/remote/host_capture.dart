import 'dart:async';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../../core/signaling_service.dart';

/// Lado HOST (dispositivo que recibe soporte).
/// Captura la pantalla con getDisplayMedia, responde al offer del técnico
/// y recibe eventos de control por DataChannel.
///
/// NOTA Fase 1: la inyección real de mouse/teclado requiere código nativo
/// por plataforma (Win32 SendInput / CGEvent en macOS / X11 XTest en Linux),
/// expuesto vía FFI o MethodChannel. Acá queda el punto de integración.
class HostCapture {
  HostCapture(this.signaling);

  final SignalingService signaling;
  RTCPeerConnection? _pc;
  MediaStream? _screen;

  // Subscripciones a streams — deben cancelarse en stop() para evitar leaks
  StreamSubscription<Map<String, dynamic>>? _offerSub;
  StreamSubscription<Map<String, dynamic>>? _iceSub;

  Future<void> startForSession(
      String sessionId, List<Map<String, dynamic>> iceServers) async {
    _pc = await createPeerConnection({'iceServers': iceServers});

    _screen = await navigator.mediaDevices.getDisplayMedia({
      'video': {'frameRate': 30},
      'audio': false,
    });
    for (final track in _screen!.getTracks()) {
      await _pc!.addTrack(track, _screen!);
    }

    _pc!
      ..onIceCandidate = (c) => signaling.sendIce(sessionId, c.toMap())
      ..onDataChannel = (channel) {
        if (channel.label == 'control') {
          channel.onMessage = (msg) => _handleControl(msg.text);
        }
        // channel 'files': armar receptor de chunks en Fase 2
      };

    // Guardar subscripciones para cancelarlas en stop()
    _offerSub = signaling.onOffer.stream.listen((d) async {
      final p = d['payload'];
      await _pc!.setRemoteDescription(
          RTCSessionDescription(p['sdp'], p['type']));
      final answer = await _pc!.createAnswer();
      await _pc!.setLocalDescription(answer);
      signaling.sendAnswer(sessionId, answer.toMap());
    });

    _iceSub = signaling.onIce.stream.listen((d) async {
      final p = d['payload'];
      await _pc!.addCandidate(
          RTCIceCandidate(p['candidate'], p['sdpMid'], p['sdpMLineIndex']));
    });
  }

  void _handleControl(String json) {
    // TODO Fase 1: parsear {"t":"move|down|up|key","x":0.42,"y":0.31}
    // y delegar a la capa nativa de inyección de input de cada SO.
  }

  Future<void> stop() async {
    // Cancelar subscripciones primero para evitar memory leaks
    await _offerSub?.cancel();
    await _iceSub?.cancel();
    _offerSub = null;
    _iceSub = null;

    _screen?.getTracks().forEach((t) => t.stop());
    await _pc?.close();
  }
}
