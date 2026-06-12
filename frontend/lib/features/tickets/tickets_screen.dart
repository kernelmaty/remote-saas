import 'package:flutter/material.dart';
import '../../core/api_client.dart';

class TicketsScreen extends StatefulWidget {
  const TicketsScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<TicketsScreen> createState() => _TicketsScreenState();
}

class _TicketsScreenState extends State<TicketsScreen> {
  List<dynamic> _tickets = [];
  bool _loading = true;

  static const _priorityColor = {
    'critical': Colors.red, 'high': Colors.deepOrange,
    'medium': Colors.amber, 'low': Colors.green,
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final data = await widget.api.getTickets();
    if (mounted) setState(() { _tickets = data; _loading = false; });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tickets')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {/* abrir formulario de alta */},
        icon: const Icon(Icons.add),
        label: const Text('Nuevo'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.separated(
                itemCount: _tickets.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  final t = _tickets[i];
                  return ListTile(
                    leading: CircleAvatar(
                      backgroundColor:
                          _priorityColor[t['priority']] ?? Colors.grey,
                      radius: 6,
                    ),
                    title: Text('#${t['number']}  ${t['title']}'),
                    subtitle: Text(t['client_name'] ?? 'Sin cliente'),
                    trailing: Chip(label: Text(t['status'])),
                  );
                },
              ),
            ),
    );
  }
}
