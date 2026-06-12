import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Cliente HTTP con inyección de JWT y refresh automático ante 401.
class ApiClient {
  ApiClient({required this.baseUrl}) {
    _dio = Dio(BaseOptions(baseUrl: '$baseUrl/api/v1'));
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _storage.read(key: 'accessToken');
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
      onError: (e, handler) async {
        if (e.response?.statusCode == 401 && e.requestOptions.extra['retried'] != true) {
          final ok = await _refresh();
          if (ok) {
            final opts = e.requestOptions..extra['retried'] = true;
            return handler.resolve(await _dio.fetch(opts));
          }
        }
        handler.next(e);
      },
    ));
  }

  final String baseUrl;
  late final Dio _dio;
  final _storage = const FlutterSecureStorage();

  Future<bool> login(String email, String password) async {
    final res = await _dio.post('/auth/login',
        data: {'email': email, 'password': password});
    await _storage.write(key: 'accessToken', value: res.data['accessToken']);
    await _storage.write(key: 'refreshToken', value: res.data['refreshToken']);
    return true;
  }

  Future<bool> _refresh() async {
    final refresh = await _storage.read(key: 'refreshToken');
    if (refresh == null) return false;
    try {
      final res = await Dio(BaseOptions(baseUrl: '$baseUrl/api/v1'))
          .post('/auth/refresh', data: {'refreshToken': refresh});
      await _storage.write(key: 'accessToken', value: res.data['accessToken']);
      await _storage.write(key: 'refreshToken', value: res.data['refreshToken']);
      return true;
    } catch (_) {
      await _storage.deleteAll();
      return false;
    }
  }

  Future<List<dynamic>> getClients() async =>
      (await _dio.get('/clients')).data as List;
  Future<List<dynamic>> getTickets({String? status}) async =>
      (await _dio.get('/tickets', queryParameters: {if (status != null) 'status': status}))
          .data as List;
  Future<Map<String, dynamic>> getDashboard() async =>
      (await _dio.get('/dashboard/summary')).data as Map<String, dynamic>;
}
