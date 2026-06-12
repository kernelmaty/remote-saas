import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'features/auth/login_screen.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/tickets/tickets_screen.dart';
import 'core/api_client.dart';

// URL base de la API — ajustar en produccion
const _kApiBase = String.fromEnvironment('API_BASE_URL',
    defaultValue: 'http://localhost:4000');

final _api = ApiClient(baseUrl: _kApiBase);

final _router = GoRouter(
  initialLocation: '/login',
  routes: [
    GoRoute(
      path: '/login',
      builder: (context, state) => LoginScreen(api: _api),
    ),
    GoRoute(
      path: '/dashboard',
      builder: (context, state) => DashboardScreen(api: _api),
    ),
    GoRoute(
      path: '/tickets',
      builder: (context, state) => TicketsScreen(api: _api),
    ),
  ],
);

void main() => runApp(const ProviderScope(child: RemoteDeskApp()));

class RemoteDeskApp extends StatelessWidget {
  const RemoteDeskApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'RemoteDesk',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF2563EB),
        useMaterial3: true,
      ),
      routerConfig: _router,
    );
  }
}
