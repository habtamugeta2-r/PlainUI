import 'package:flutter/material.dart';

import 'generated/inbox.pui.dart';
import 'generated/plainui_routes.dart';
import 'generated/theme.pui.dart';

/// Beacon — the app the Flutter-depth phase is judged by.
///
/// Every screen, the navigation between them, the design tokens, the async loads, the validation
/// and the list identity are written in `.pui`. What is left here is what a host program is for:
/// choosing the first screen, installing the theme, and mapping a name that arrives from outside
/// the app (a deep link) onto a screen.
void main() => runApp(const BeaconApp());

class BeaconApp extends StatelessWidget {
  const BeaconApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Beacon',
      theme: BeaconTheme.light,
      home: const Inbox(),
      onGenerateRoute: (RouteSettings settings) {
        final Widget Function(Map<String, Object?>)? factory = puiRoutes[settings.name];
        if (factory == null) return null;
        final Object? arguments = settings.arguments;
        return MaterialPageRoute<void>(
          settings: settings,
          builder: (_) => factory(arguments is Map<String, Object?> ? arguments : const <String, Object?>{}),
        );
      },
    );
  }
}
