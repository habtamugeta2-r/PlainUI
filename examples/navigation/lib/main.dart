import 'package:flutter/material.dart';

import 'generated/home.pui.dart';
import 'generated/plainui_routes.dart';

/// Navigation is written in the `.pui` files: Home opens Detail, Detail calls `back()`.
///
/// The host program only needs two things: a screen to open on, and — for names that arrive from
/// outside the app, such as a deep link — the generated route table.
void main() => runApp(const NavigationApp());

class NavigationApp extends StatelessWidget {
  const NavigationApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PlainUI navigation',
      theme: ThemeData(colorSchemeSeed: const Color(0xFF2563EB), useMaterial3: true),
      home: const Home(),
      // A real app would map `/tasks/:id` here; `puiRoutes` is what makes that a lookup instead of
      // a switch over screen names.
      onGenerateRoute: (settings) {
        final Object? arguments = settings.arguments;
        final factory = puiRoutes[settings.name];
        if (factory == null) return null;
        return MaterialPageRoute<void>(
          settings: settings,
          builder: (_) => factory(arguments is Map<String, Object?> ? arguments : const <String, Object?>{}),
        );
      },
    );
  }
}

/// Opens a screen by name — how a `Detail` link from a notification or a URL reaches the same
/// widget `navigate Detail(id: ...)` builds.
void openScreen(BuildContext context, String name, Map<String, Object?> arguments) {
  final factory = puiRoutes[name];
  if (factory == null) return;
  Navigator.push<void>(context, MaterialPageRoute<void>(builder: (_) => factory(arguments)));
}
