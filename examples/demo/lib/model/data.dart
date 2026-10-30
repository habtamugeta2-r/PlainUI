import 'dart:async';

/// The demo's data: an in-memory store behind an async boundary, so every screen reads through a
/// `task` exactly as it would against a network.
///
/// This file is the entire hand-written Dart of the app besides `main.dart`, and it is the only
/// place that knows what an `Issue` is — the `.pui` files declare the surface they call, so the
/// compiler checks their arguments against these signatures.
class Issue {
  const Issue({required this.id, required this.title, required this.open});

  final String id;
  final String title;
  final bool open;
}

final List<Issue> _issues = <Issue>[
  const Issue(id: 'pui-1', title: 'Derive instead of storing', open: true),
  const Issue(id: 'pui-2', title: 'Watch one state, not every state', open: true),
  const Issue(id: 'pui-3', title: 'Validate before the handler runs', open: false),
  const Issue(id: 'pui-4', title: 'Cancel the request nobody is waiting for', open: true),
];

final Map<String, List<String>> _comments = <String, List<String>>{
  'pui-1': <String>['Computed, so it cannot be stale.', 'A getter is the whole trick.'],
  'pui-2': <String>['The header is the dependency list.'],
  'pui-3': <String>[],
  'pui-4': <String>['Latest wins, every time.'],
};

Future<void> _settle() => Future<void>.delayed(const Duration(milliseconds: 150));

/// Every issue whose title contains [filter], case-insensitively.
Future<List<Issue>> loadIssues(String filter) async {
  await _settle();
  final String query = filter.trim().toLowerCase();
  if (query.isEmpty) return List<Issue>.unmodifiable(_issues);
  return List<Issue>.unmodifiable(
    _issues.where((Issue issue) => issue.title.toLowerCase().contains(query)),
  );
}

/// The comment thread of one issue, oldest first.
Future<List<String>> loadComments(String id) async {
  await _settle();
  return List<String>.unmodifiable(_comments[id] ?? const <String>[]);
}

Future<void> addComment(String id, String body) async {
  await _settle();
  (_comments[id] ??= <String>[]).add(body);
}

Future<void> createIssue(String title, String body) async {
  await _settle();
  final String id = 'pui-${_issues.length + 1}';
  _issues.add(Issue(id: id, title: title, open: true));
  if (body.trim().isNotEmpty) _comments[id] = <String>[body];
}
