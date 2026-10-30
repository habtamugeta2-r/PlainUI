import 'package:flutter/material.dart';

import 'generated/async.pui.dart';
import 'generated/race.pui.dart';

void main() => runApp(const AsyncApp());

/// A host application. The screens own their loading, error and retry; `main.dart` only decides
/// which theme to run them under, and which one to open.
///
/// `Async` filters a list; `Race` is the same machinery under a race — a retry that starts while
/// the first load is still running. Two PlainUI screens in an otherwise ordinary Flutter app.
class AsyncApp extends StatelessWidget {
  const AsyncApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PlainUI async',
      theme: AsyncTheme.light,
      home: const _Menu(),
    );
  }
}

class _Menu extends StatelessWidget {
  const _Menu();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('PlainUI async')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            ElevatedButton(
              onPressed: () => _open(context, const Async()),
              child: const Text('Async'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () => _open(context, const Race()),
              child: const Text('Race'),
            ),
          ],
        ),
      ),
    );
  }

  void _open(BuildContext context, Widget screen) {
    Navigator.push<void>(context, MaterialPageRoute<void>(builder: (_) => screen));
  }
}
