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

Open `index.html` in any modern browser — no install or build step needed.

Demo account: school number `10001`, password `demo1234`
(or click **"Try the demo account"** on the login page).

## How it works under the hood

The site is a static front end backed by **Supabase** (a hosted Postgres
database with authentication and file storage):

- **Accounts** use Supabase Auth. Students sign in with their school number,
  which is mapped to a synthetic email behind the scenes. Passwords are
  properly hashed by the auth service.
- **Items and swap requests** live in Postgres tables protected by Row Level
  Security: anyone can browse, but only owners can edit or delete their items,
  and only the two students involved can see a swap request.
- **Photos** are resized in the browser, then uploaded to a public Supabase
  storage bucket.
- **Accepting a swap** runs as a database function so both items are marked
  swapped atomically, and competing requests are auto-declined.

The full database setup (tables, security policies, functions) is in
[`supabase/setup.sql`](supabase/setup.sql) — paste it into the Supabase SQL
Editor to recreate the backend on a fresh project. Project credentials live in
[`js/config.js`](js/config.js); the anon key is safe to publish because all
access is controlled by the security policies.

## Project structure

```
index.html         Landing page
login.html         Log in / create account
browse.html        Item board with search & filters
upload.html        Post an item
item.html          Item details & swap requests
profile.html       Your items, incoming & sent requests
css/style.css      Stylesheet (school-notebook theme)
js/config.js       Supabase project URL + anon key
js/store.js        Data layer (Supabase backend)
js/app.js          Shared UI helpers
supabase/setup.sql Database schema, security policies & functions
```

## Deploying

The site is fully static, so it can be hosted on **GitHub Pages**:
repo → Settings → Pages → deploy from the `main` branch, root folder.
