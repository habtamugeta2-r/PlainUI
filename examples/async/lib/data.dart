// The host side of the async example: a real Future, so the generated task has something to await.

import 'dart:async';

/// Stands in for a repository call. Fails for the empty string so the error branch can be seen.
Future<List<String>> loadTasks(String filter) async {
  await Future<void>.delayed(const Duration(milliseconds: 200));
  const all = ['Write the spec', 'Build the compiler', 'Ship it'];
  if (filter == 'boom') throw StateError('the backend is down');
  return all.where((task) => task.toLowerCase().contains(filter.toLowerCase())).toList();
}

/// The first call is slow and returns stale data; every later call is fast and returns fresh data.
///
/// That is the shape of the bug a generated task loader has to survive: the retry finishes first,
/// the original load finishes later, and without a sequence number the stale result would overwrite
/// the fresh one. `race.pui` is the screen that shows it.
int _raceCalls = 0;

Future<List<String>> loadSlowThenFast() async {
  _raceCalls += 1;
  final first = _raceCalls == 1;
  await Future<void>.delayed(Duration(milliseconds: first ? 400 : 20));
  return first ? const ['stale result'] : const ['fresh result'];
}
