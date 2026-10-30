/**
 * The playground's starting points. Each one is small, valid PlainUI and is compiled by
 * `tests/playground.test.ts`, so an example cannot rot into something that does not build.
 */

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly source: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'counter',
    title: 'Counter',
    source: `// State, events and text styles.

style price:
    size=20
    weight=bold
    color=#1d4ed8

screen Counter:

    state count: Int = 0
    state name: Text = "PlainUI"

    column padding=24 gap=16 main=center:

        text "Hello, \${name}" style=heading
        text count style=display
        text "Escalations" style=caption

        row gap=12 main=center:
            button "−":
                on tap:
                    set count = count - 1
            button "Reset":
                on tap:
                    set count = 0
            button "+":
                on tap:
                    set count = count + 1

        text "0 ETB" style=price
`,
  },
  {
    id: 'card',
    title: 'Profile card',
    source: `// Layout widgets, a component and a slot.

component Stat(label: Text, value: Text):

    column gap=2 cross=center:
        text value style=subheading
        text label style=caption

screen Profile:

    state following: Bool = false

    column padding=24 gap=16:

        card padding=20 radius=16:
            column gap=12 cross=center:
                card padding=18 radius=999:
                    icon person size=32
                text "Ada Lovelace" style=heading
                text "Mathematician · London" style=secondary

                row gap=24:
                    Stat("Followers", "12.4k")
                    Stat("Following", "310")

                button following ? "Following" : "Follow":
                    on tap:
                        set following = !following

        divider

        wrap gap=8:
            text "Engineering" style=label
            text "Design" style=label
            text "Writing" style=label
`,
  },
  {
    id: 'todo',
    title: 'Todo list',
    source: `// A list, a loop and a conditional in one screen.

component Task(title: Text):

    row gap=8 main=between:
        text title
        button "Done"

screen Todo:

    state items: List<Text> = ["Write the spec", "Build the compiler", "Ship it"]

    column padding=20 gap=12:

        text "Today" style=heading

        input placeholder="Add a task" padding=10

        column gap=8:
            for index, item in items:
                card padding=12 radius=10:
                    Task(item)

        if items.length == 0:
            text "Nothing left. Enjoy the day." style=caption
        else:
            text "\${items.length} tasks" style=label
`,
  },
];
