// The host side of the async example: a real Future, so the generated task has something to await.

import 'dart:async';

/// Stands in for a repository call. Fails for the empty string so the error branch can be seen.
Future<List<String>> loadTasks(String filter) async {
  await Future<void>.delayed(const Duration(milliseconds: 200));
  const all = ['Write the spec', 'Build the compiler', 'Ship it'];
  if (filter == 'boom') throw StateError('the backend is down');
  return all.where((task) => task.toLowerCase().contains(filter.toLowerCase())).toList();
}
