# Setting Up React (Complete Beginner Guide)

Written for someone who has never used React *or* the command line. Every command is
explained before you type it, so you know what it does rather than just copying it.

## Goal

By the end you will have a working React app running in your browser, live-updating as you
edit the code. Total time: about 15 minutes.

---

## Prerequisites

- **macOS** (this guide uses the built-in Terminal app)
- **Node.js and npm** — already installed on this machine: Node `v22.17.1`, npm `10.9.2`.
  Step 2 shows how to confirm this yourself.
- A code editor — you already have Cursor.

No prior React or terminal knowledge assumed.

---

## Step 0 — Command line crash course

Skip this if you have used a terminal before.

### What the terminal is

The Terminal is a text-based way to control your computer. Instead of clicking a folder to
open it, you type its name. It feels alien at first, but you only need about four commands
to get through this tutorial.

### Opening it

Press `Cmd + Space`, type `Terminal`, press `Enter`. A window opens with a line like:

```
wuyuying@MacBook ~ %
```

That is the **prompt**. It is waiting for you to type. The `%` marks where your typing
begins — you never type the `%` itself.

> **Note on this guide's code blocks:** when you see a command below, type everything
> *after* the prompt symbol, then press `Enter`. Lines starting with `#` are comments for
> you to read, not commands to run.

### The four commands you need

You are always "standing inside" one folder, called the **working directory**. These
commands let you see where you are and move around.

| Command | What it does | Memory aid |
| --- | --- | --- |
| `pwd` | Prints the folder you are currently in | **p**rint **w**orking **d**irectory |
| `ls` | Lists the files and folders where you are | **l**i**s**t |
| `cd foldername` | Moves *into* that folder | **c**hange **d**irectory |
| `cd ..` | Moves *up* one folder, toward the parent | `..` means "one level up" |

Try them now — they cannot break anything:

```bash
pwd
ls
```

### Three survival tips

1. **Tab completes names.** Type `cd Doc` then press `Tab` and the terminal finishes
   `Documents/` for you. This prevents typos, so use it constantly.
2. **`Ctrl + C` stops whatever is running.** If the terminal seems frozen or is printing
   endlessly, press `Ctrl + C` to get your prompt back. This is the escape hatch.
3. **Up arrow repeats.** Press the up arrow to bring back your previous command instead of
   retyping it.

### Folder names with spaces

If a folder name contains a space, wrap the whole path in quotes, otherwise the terminal
reads it as two separate things:

```bash
cd "My Project Folder"    # correct
cd My Project Folder      # breaks
```

---

## Step 1 — Navigate to your project folder

Move into this repository. On this machine:

```bash
cd ~/Documents/Github_Project/Coursework-Cornell-AAP-IT
```

The `~` is shorthand for your home folder (`/Users/wuyuying`), so this saves typing.

Confirm you landed in the right place:

```bash
pwd
```

It should print `/Users/wuyuying/Documents/Github_Project/Coursework-Cornell-AAP-IT`.

---

## Step 2 — Check that Node.js is installed

React is built with Node.js, and **npm** (Node Package Manager) is the tool that downloads
code libraries for you. Check both are present:

```bash
node --version
npm --version
```

Expected output:

```
v22.17.1
10.9.2
```

Your numbers may be slightly higher — that is fine. Anything from **Node 18 upward** works
with React.

If instead you see `command not found: node`, Node is not installed. Download the **LTS**
version from [nodejs.org](https://nodejs.org/), run the installer, then **close and reopen
Terminal** before checking again. That last part matters: a terminal window only reads its
settings at startup, so an already-open window will not see the new install.

---

## Step 3 — Create the React app

We will use **Vite** (pronounced "veet"), a tool that generates a ready-to-go React project
and provides a fast development server.

Run this from inside your repo folder:

```bash
npm create vite@latest react-practice -- --template react
```

Breaking that down so it is not just magic:

- `npm create vite@latest` — fetch and run the latest Vite project generator
- `react-practice` — the folder name to create; change this if you want a different name
- `--` — separates npm's own options from the ones being passed through to Vite
- `--template react` — generate a React project rather than Vue, Svelte, or plain JS

**The first time you run this**, npm asks permission to download the generator:

```
Need to install the following packages:
create-vite@latest
Ok to proceed? (y)
```

Type `y` and press `Enter`.

When it finishes you will see a success message and a suggestion to run three commands.
Do those next, one at a time.

---

## Step 4 — Install the dependencies

Move into the newly created folder:

```bash
cd react-practice
```

Then download the libraries the project needs:

```bash
npm install
```

This reads the list of required libraries from a file called `package.json` and downloads
them into a folder called `node_modules`. It takes 10–30 seconds and prints a wall of text
— that is normal.

You may see a line like `found 2 moderate severity vulnerabilities`. **Ignore this.** It is
extremely common in fresh projects, refers to development-only tooling, and does not affect
a learning project. Do not run `npm audit fix --force`, which is more likely to break your
project than help it.

---

## Step 5 — Start the development server

```bash
npm run dev
```

You should see:

```
  VITE v7.1.5  ready in 312 ms

  ➜  Local:   http://localhost:5173/
  ➜  press h + enter to show help
```

`Cmd + click` that `http://localhost:5173/` link, or paste it into your browser. The React
welcome page appears with a counter button.

**Important:** the terminal now looks stuck and will not accept new commands. That is
correct — the server is running in the foreground and holding onto that window. Leave it
running while you work.

- To **stop** the server: click the terminal and press `Ctrl + C`.
- To run other commands while it runs: open a second terminal tab with `Cmd + T`.

---

## Result

You now have a running React app. To confirm it is live-updating:

1. Open `react-practice/src/App.jsx` in Cursor.
2. Find the line `<h1>Vite + React</h1>`.
3. Change the text to `<h1>Hello, Procedural World</h1>` and save.
4. Look at the browser — it updates instantly, without a refresh.

That instant update is called **hot module replacement**, and it is the main reason this
setup is pleasant to work in.

---

## Understanding what was created

You do not need to memorize this, but knowing where things live saves confusion later:

```
react-practice/
├── node_modules/        # downloaded libraries — never edit, never commit
├── public/              # static files served as-is
├── src/                 # your actual code lives here
│   ├── App.jsx          # the main component — start here
│   ├── App.css          # styles for App.jsx
│   ├── main.jsx         # entry point that mounts App into the page
│   └── index.css        # global styles
├── index.html           # the page shell React renders into
├── package.json         # project name, scripts, and dependency list
└── vite.config.js       # Vite settings
```

**For learning React, you will spend nearly all your time in `src/App.jsx`.**

A `.jsx` file is JavaScript that can also contain HTML-looking markup. That mix is called
JSX, and it is what makes React components readable.

---

## The commands you will use daily

Run these from inside the `react-practice` folder:

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `Ctrl + C` | Stop the development server |
| `npm install <name>` | Add a new library, e.g. `npm install three` |
| `npm run build` | Produce an optimized version for publishing |

---

## Notes and pitfalls

**Never commit `node_modules`.** It contains tens of thousands of files and must stay out
of Git. This repo's `.gitignore` already excludes it. You can verify nothing unwanted is
staged by running `git status` from the repo root — if you see thousands of files listed,
stop and fix `.gitignore` before committing.

**Ignore tutorials that tell you to use `create-react-app`.** You will find many, because
it was the standard for years. It is now deprecated and noticeably slow. Vite is the
current recommendation, including from the React team.

**"Port 5173 is already in use"** means a server is still running from earlier. Either find
that terminal window and press `Ctrl + C`, or just use the different port Vite offers you.

**`command not found: npm`** means Node is not installed or the terminal was opened before
installing it. Reopen Terminal and retry Step 2.

**Blank white page in the browser** almost always means a JavaScript error. Right-click the
page, choose *Inspect*, and open the **Console** tab — the error message there names the
file and line number.

**You must be in the right folder.** Nearly every beginner problem is running `npm run dev`
from the wrong place. If it fails with "could not read package.json", run `pwd` to check
where you are, then `cd` into `react-practice`.

---

## Where to go next

- [React's official tutorial](https://react.dev/learn) — the best starting point, and it is
  genuinely well written
- Try building a component that renders a grid of randomly colored squares; it is a small
  step toward the procedural generation work in this course
- Once comfortable, add three.js with `npm install three` to render 3D scenes inside React
