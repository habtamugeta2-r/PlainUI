import 'package:flutter/material.dart';

import 'generated/gallery.pui.dart';

void main() => runApp(const GalleryApp());

class GalleryApp extends StatelessWidget {
  const GalleryApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PlainUI gallery',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: const Color(0xFF7C3AED), useMaterial3: true),
      home: const Gallery(),
    );
  }
}
