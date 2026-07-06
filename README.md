# Swap, Share, Sustain ♻️

A student-run swap shop for the school community. Students exchange reusable
items — textbooks, stationery, uniforms, sports gear — instead of throwing them
away or buying new ones. Inspired by eBay, rebuilt for the school hallway.

**Save money · waste less · look out for each other.**

## Features

- **Landing page** explaining the project, with live stats and the newest items
- **Sign up / log in with your school number** (student ID), name and grade
- **Post an item** with a photo, category, condition and description
- **Browse the board** with search and category filters
- **Request a swap** — offer one of your own items in return, or just ask
- **Accept / decline requests** from your profile; accepted swaps reveal each
  other's contact details so you can meet at school and exchange in person

## Try it

Open `index.html` in any modern browser — no install, no server needed.

Demo account: school number `10001`, password `demo1234`
(or click **"Try the demo account"** on the login page).

## How it works under the hood

This is a front-end demo: there is no server. All accounts, items, photos and
swap requests are stored in the browser's **localStorage**, so data stays on
the device where it was created. A few demo students and items are seeded on
first visit.

> ⚠️ Because this is a class demo, passwords are only lightly obfuscated —
> never reuse a real password here.

## Project structure

```
index.html      Landing page
login.html      Log in / create account
browse.html     Item board with search & filters
upload.html     Post an item
item.html       Item details & swap requests
profile.html    Your items, incoming & sent requests
css/style.css   Stylesheet (school-notebook theme)
js/store.js     Data layer (localStorage demo backend)
js/app.js       Shared UI helpers
```

## Deploying

The site is fully static, so it can be hosted on **GitHub Pages**:
repo → Settings → Pages → deploy from the `main` branch, root folder.
