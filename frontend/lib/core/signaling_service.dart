import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;

/// Capa de señalización sobre Socket.IO.
/// El técnico se autentica con JWT; el host con deviceId + deviceToken.
class SignalingService {
  SignalingService(this.serverUrl);

  final String serverUrl;
  io.Socket? _socket;

  final onIncomingSession = StreamController<Map<String, dynamic>>.broadcast();
  final onSessionAccepted = StreamController<Map<String, dynamic>>.broadcast();
  final onOffer = StreamController<Map<String, dynamic>>.broadcast();
  final onAnswer = StreamController<Map<String, dynamic>>.broadcast();
  final onIce = StreamController<Map<String, dynamic>>.broadcast();
  final onChat = StreamController<Map<String, dynamic>>.broadcast();
  final onSessionEnded = StreamController<Map<String, dynamic>>.broadcast();

  void connectAsTechnician(String jwt) => _connect({'token': jwt});
  void connectAsDevice(String deviceId, String deviceToken) =>
      _connect({'deviceId': deviceId, 'deviceToken': deviceToken});

  void _connect(Map<String, dynamic> auth) {
    _socket = io.io(serverUrl, io.OptionBuilder()
        .setTransports(['websocket'])
        .setAuth(auth)
        .build());
    _socket!
      ..on('session:incoming', (d) => onIncomingSession.add(_map(d)))
      ..on('session:accepted', (d) => onSessionAccepted.add(_map(d)))
      ..on('webrtc:offer', (d) => onOffer.add(_map(d)))
      ..on('webrtc:answer', (d) => onAnswer.add(_map(d)))
      ..on('webrtc:ice', (d) => onIce.add(_map(d)))
      ..on('chat:message', (d) => onChat.add(_map(d)))
      ..on('session:ended', (d) => onSessionEnded.add(_map(d)));
  }

  Map<String, dynamic> _map(dynamic d) => Map<String, dynamic>.from(d as Map);

  Future<String?> requestSession(String deviceId, {String? ticketId}) async {
    final completer = Completer<String?>();
    _socket!.emitWithAck('session:request',
        {'deviceId': deviceId, 'ticketId': ticketId},
        ack: (res) => completer.complete(res?['sessionId'] as String?));
    return completer.future;
  }

  void acceptSession(String sessionId) =>
      _socket!.emit('session:accept', {'sessionId': sessionId});
  void sendOffer(String sessionId, dynamic sdp) =>
      _socket!.emit('webrtc:offer', {'sessionId': sessionId, 'payload': sdp});
  void sendAnswer(String sessionId, dynamic sdp) =>
      _socket!.emit('webrtc:answer', {'sessionId': sessionId, 'payload': sdp});
  void sendIce(String sessionId, dynamic candidate) =>
      _socket!.emit('webrtc:ice', {'sessionId': sessionId, 'payload': candidate});
  void sendChat(String? sessionId, String text) =>
      _socket!.emit('chat:message', {'sessionId': sessionId, 'text': text});
  void endSession(String sessionId) =>
      _socket!.emit('session:end', {'sessionId': sessionId});

  void dispose() => _socket?.dispose();
}
