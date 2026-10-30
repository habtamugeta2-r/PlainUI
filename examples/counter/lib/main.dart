import 'package:flutter/material.dart';

import 'generated/counter.pui.dart';

void main() => runApp(const CounterApp());

/// A host application: PlainUI generates widgets, `main.dart` decides what to run.
class CounterApp extends StatelessWidget {
  const CounterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PlainUI counter',
      theme: ThemeData(colorSchemeSeed: const Color(0xFF2563EB), useMaterial3: true),
      home: const Counter(),
    );
  }
}
