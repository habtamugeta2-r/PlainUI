import 'package:flutter/material.dart';

import 'generated/async.pui.dart';

void main() => runApp(const AsyncApp());

/// A host application. The screen owns its loading, error and retry; `main.dart` only decides
/// which theme to run it under.
class AsyncApp extends StatelessWidget {
  const AsyncApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PlainUI async',
      theme: AsyncTheme.light,
      home: const Async(),
    );
  }
}
