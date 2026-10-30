import 'package:flutter/material.dart';

import 'generated/todo.pui.dart';

void main() => runApp(const TodoApp());

class TodoApp extends StatelessWidget {
  const TodoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PlainUI todo',
      theme: ThemeData(colorSchemeSeed: const Color(0xFF16A34A), useMaterial3: true),
      home: const Todo(),
    );
  }
}
