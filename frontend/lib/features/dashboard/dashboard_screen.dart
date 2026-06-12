import 'package:flutter/material.dart';
import '../../core/api_client.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Map<String, dynamic>? _summary;

  @override
  void initState() {
    super.initState();
    widget.api.getDashboard().then((d) => setState(() => _summary = d));
  }

  @override
  Widget build(BuildContext context) {
    final s = _summary;
    return Scaffold(
      appBar: AppBar(title: const Text('RemoteDesk — Dashboard')),
      body: s == null
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(16),
              child: Wrap(
                spacing: 16,
                runSpacing: 16,
                children: [
                  _kpi('Sesiones hoy', s['sessions_today']),
                  _kpi('Sesiones activas', s['sessions_active']),
                  _kpi('Tickets abiertos', s['tickets_open']),
                  _kpi('Equipos online', s['devices_online']),
                  _kpi('Clientes', s['clients_total']),
                ],
              ),
            ),
    );
  }

  Widget _kpi(String label, dynamic value) => Card(
        child: Container(
          width: 180,
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${value ?? '-'}',
                  style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold)),
              Text(label, style: const TextStyle(color: Colors.grey)),
            ],
          ),
        ),
      );
}
