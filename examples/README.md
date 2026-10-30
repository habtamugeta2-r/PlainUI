# Examples

Each directory is a complete Flutter project skeleton that uses PlainUI for its UI:

| Example | Shows |
| --- | --- |
| [`counter`](counter) | State, events, `bind=` on a text field, text styles, button variants |
| [`todo`](todo) | A component from another file with a `slot`, loops, method calls on state |
| [`gallery`](gallery) | Every built-in element and property in one scrollable screen |
| [`async`](async) | A `task`: loading, error and retry states the compiler owns |
| [`navigation`](navigation) | Two screens in two files: parameters, `navigate`, `back()`, and the generated route table |

They are compiled by `tests/examples.test.ts`, so they cannot drift.

## Running one

The Dart host files (`lib/main.dart`) are checked in; the generated widgets are not.

```bash
npm run build            # build the compiler once
cp -r examples/counter /tmp/counter && cd /tmp/counter
flutter create .         # add the platform folders around the existing lib/
node /path/to/PlainUI/dist/cli.js build
flutter run
```

`flutter create` keeps existing files, so `lib/main.dart` and `lib/ui/` survive; it only adds
the `android/`, `ios/`, `web/` … scaffolding around them.
