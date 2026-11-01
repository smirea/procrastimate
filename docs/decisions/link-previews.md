# Link previews

A bare URL pasted into a title becomes `[page title](url)`, and every link, in titles, notes, and comments, on both clients, shows its site's icon before it.

## Titles

- **A paste, not a sync field.** The title lands in the text as the Markdown link `linkify` already reads (see `shared/links.ts`), so nothing new syncs, Todoist links keep working, and the raw text stays editable. There is no stored preview per link.
- **Only a paste of one bare URL.** `pastedUrl` accepts a paste that is one bare `http(s)://` or `www.` URL and nothing else. A URL typed by hand, or pasted inside other text, stays bare. Web hooks the textarea's `paste` event. iOS has no text paste event on SwiftUI's `TextEditor`, so `SmartInput` reads a paste as one edit that inserts a whole URL at once.
- **The paste goes in first.** The URL appears at once and the title replaces it when it arrives, through `titleLink`, only while the field still has focus and the bare URL still sits where it landed. A save before the title arrives keeps the bare URL. Offline, or when the page cannot be read, the URL stays bare. Brackets in a title become parentheses, the only characters a Markdown label cannot hold.
- **The server reads the page.** `GET /api/link-preview?url=` (human users only) fetches the page, since a browser cannot read another origin and the web client talks only to its own. It reads the head, up to `</head>` or 2 MB (YouTube's `<title>` sits 770 KB in), with a 5 second limit, and answers the `<title>`, else `og:title` or `twitter:title`.
- **Site rules where the tab names the site.** `SITE_TITLES` in `server/src/link-preview.ts` lists sites whose `<title>` is the site's name, with where the page's own name is, checked against the URL the redirects landed on. A Google Maps place reads `Google Maps` in its tab, so it takes the name from `og:title` (`HEAT Bootcamp · 5.0★(190) · Fitness center`) before the first `·`: the rating and category would go stale in a task title. `og:title` is not preferred everywhere, since GitHub's reads `smirea - Overview` where its tab reads `smirea (Stefan Mirea) · GitHub`. Its user agent carries `facebookexternalhit/1.1`, the link expanders' token, since sites such as the NYT refuse unknown bots and serve link expanders their metadata.

## Icons

- **From our own origin, by page.** `GET /api/favicon?url=` answers the icon of the page the link opens, after redirects: its declared `icon` nearest 32 px, then an unsized one, then the Apple touch icon, then its site's `/favicon.ico`. By page, not by host: a `maps.app.goo.gl` short link is Firebase's host and showed Firebase's flame, and the page it lands on, Google Maps, declares its pin, which differs from Google's own icon too. The cost is one fetch per link instead of per site. SVG icons are skipped, since iOS cannot draw them as an image. A third-party favicon service was ruled out by the single-origin rule.
- **Cached by the client.** The route answers `Cache-Control: private, max-age=604800`, and a miss for a day, so the browser and `URLCache` ask once per link. The server keeps nothing. The web hides an icon that failed for every link to that page. iOS keeps each link's icon in `Favicons`, which `Links.text` reads, and draws it as an image inside the `Text`.
- **Needs a session.** Both routes need a signed-in user, so a public link viewer sees links without icons.

## Safety

- **Public hosts only.** `publicHost` refuses IP literals, `localhost`, single-label names, and `.local`, `.internal`, `.lan`, `.home`, and `.arpa` names, and redirects are followed by hand so each hop is checked. The Worker cannot reach a private network anyway; this keeps the Bun dev server from fetching whatever its machine reaches. DNS that points a public name at a private address is not checked.
