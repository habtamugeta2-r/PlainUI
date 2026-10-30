import 'package:flutter/material.dart';

import 'generated/profile.pui.dart';
import 'generated/signup.pui.dart';

void main() => runApp(const FormsApp());

/// A host application for two PlainUI forms. `main.dart` only picks the theme and the first screen;
/// the validation, the errors and the gate belong to the `.pui` files.
class FormsApp extends StatelessWidget {
  const FormsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PlainUI forms',
      theme: SignupTheme.light,
      home: const _Menu(),
    );
  }
}

class _Menu extends StatelessWidget {
  const _Menu();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('PlainUI forms')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            ElevatedButton(
              onPressed: () => _open(context, const Signup()),
              child: const Text('Sign up'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () => _open(context, const Profile()),
              child: const Text('Profile'),
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
