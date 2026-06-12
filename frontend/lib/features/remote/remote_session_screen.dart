import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../../core/signaling_service.dart';

/// Pantalla del TÉCNICO: ve la pantalla remota y envía eventos de
/// mouse/teclado por DataChannel ('control'). El host (otro build de esta
/// app en modo device) captura con getDisplayMedia e inyecta el input.
class RemoteSessionScreen extends StatefulWidget {
  const RemoteSessionScreen({
    super.key,
    required this.signaling,
    required this.sessionId,
    required this.iceServers,
  });

  final SignalingService signaling;
  final String sessionId;
  final List<Map<String, dynamic>> iceServers;

  @override
  State<RemoteSessionScreen> createState() => _RemoteSessionScreenState();
}

class _RemoteSessionScreenState extends State<RemoteSessionScreen> {
  final _renderer = RTCVideoRenderer();
  RTCPeerConnection? _pc;
  RTCDataChannel? _control;
  RTCDataChannel? _files;
  bool _connected = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await _renderer.initialize();

    _pc = await createPeerConnection({'iceServers': widget.iceServers});

    // DataChannels: control de input y transferencia de archivos
    _control = await _pc!.createDataChannel('control',
        RTCDataChannelInit()..ordered = true);
    _files = await _pc!.createDataChannel('files',
        RTCDataChannelInit()..ordered = true);

    _pc!
      ..onIceCandidate = (c) =>
          widget.signaling.sendIce(widget.sessionId, c.toMap())
      ..onTrack = (event) {
        if (event.track.kind == 'video') {
          setState(() {
            _renderer.srcObject = event.streams.first;
            _connected = true;
          });
        }
      };

    widget.signaling.onAnswer.stream.listen((d) async {
      final p = d['payload'];
      await _pc!.setRemoteDescription(
          RTCSessionDescription(p['sdp'], p['type']));
    });
    widget.signaling.onIce.stream.listen((d) async {
      final p = d['payload'];
      await _pc!.addCandidate(RTCIceCandidate(
          p['candidate'], p['sdpMid'], p['sdpMLineIndex']));
    });
    widget.signaling.onSessionEnded.stream.listen((_) {
      if (mounted) Navigator.of(context).pop();
    });

    // Recibimos video, no enviamos
    await _pc!.addTransceiver(
      kind: RTCRtpMediaType.RTCRtpMediaTypeVideo,
      init: RTCRtpTransceiverInit(direction: TransceiverDirection.RecvOnly),
    );

    final offer = await _pc!.createOffer();
    await _pc!.setLocalDescription(offer);
    widget.signaling.sendOffer(widget.sessionId, offer.toMap());
  }

  void _sendPointer(Offset pos, Size area, String type) {
    if (_control?.state != RTCDataChannelState.RTCDataChannelOpen) return;
    // Coordenadas normalizadas 0..1: el host las escala a su resolución
    _control!.send(RTCDataChannelMessage(
        '{"t":"$type","x":${(pos.dx / area.width).toStringAsFixed(4)},'
        '"y":${(pos.dy / area.height).toStringAsFixed(4)}}'));
  }

  @override
  void dispose() {
    widget.signaling.endSession(widget.sessionId);
    _control?.close();
    _files?.close();
    _pc?.close();
    _renderer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_connected ? 'Sesión activa' : 'Conectando…'),
        actions: [
          IconButton(
            icon: const Icon(Icons.chat_outlined),
            onPressed: () {/* abrir panel de chat */},
          ),
          IconButton(
            icon: const Icon(Icons.stop_circle_outlined, color: Colors.red),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final area = Size(constraints.maxWidth, constraints.maxHeight);
          return Listener(
            onPointerHover: (e) => _sendPointer(e.localPosition, area, 'move'),
            onPointerDown: (e) => _sendPointer(e.localPosition, area, 'down'),
            onPointerUp: (e) => _sendPointer(e.localPosition, area, 'up'),
            child: RTCVideoView(_renderer,
                objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitContain),
          );
        },
      ),
    );
  }
}
