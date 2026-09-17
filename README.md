# Labulubius Workspace

A personal web workspace for useful links, ideas, and open technologies. The interface is inspired by KDE Plasma and uses the official Breeze and Breeze Dark color systems for a clean, consistent desktop-like experience.

## Features

- Responsive KDE Breeze-inspired interface
- Light, dark, and system color themes
- Curated website directory with search and category filters
- Dedicated home, navigator, and about pages
- Automatic routing for `nav.labulubius.com`
- Accessible labels and semantic navigation

## Pages

| Route | Description |
| --- | --- |
| `/` | Workspace home page |
| `/nav` | Searchable directory of curated websites |
| `/about` | Project overview and design principles |

Requests to `nav.labulubius.com` are rewritten to the corresponding `/nav` route by `proxy.ts`.

## Tech Stack

- [Next.js](https://nextjs.org/) 16
- [React](https://react.dev/) 19
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) 4
- [Lucide React](https://lucide.dev/)

## Getting Started

### Requirements

- Node.js 20.9 or newer
- npm

### Installation

```bash
git clone git@github.com:labulubius/web.git
cd web
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. To test the navigator hostname locally, map `nav.localhost` to your local environment and open [http://nav.localhost:3000](http://nav.localhost:3000).

## Available Scripts

```bash
npm run dev    # Start the development server
npm run build  # Create an optimized production build
npm run start  # Start the production server
npm run lint   # Run ESLint
```

## Project Structure

```text
app/
├── about/             # About page
├── nav/               # Website directory, data, and styles
├── globals.css        # Global Breeze theme and layout styles
├── layout.tsx         # Root layout and metadata
├── page.tsx           # Home page
└── site-shell.tsx     # Shared navigation, theme control, and status bar
proxy.ts               # Host-based routing for the navigator subdomain
```

## Adding a Website

Add an entry to `app/nav/sites.ts`:

```ts
{
  name: "Example",
  description: "A short description of the website.",
  url: "https://example.com/",
  category: "Category",
  initials: "EX",
  accent: "linear-gradient(135deg, #3daee9, #1d99f3)",
}
```

The category list and item counts are generated automatically.

## Production

Build and start the application with:

```bash
npm run build
npm run start
```

In production, place the Next.js server behind a reverse proxy and forward the original `Host` header so host-based navigator routing continues to work.

## License

No license has been specified for this repository.
