# Sign in

Signed out, both clients open on the sign-in screen: the ProcrastiMate sloth, without its tile, sits above a glass card headed `ProcrastiMate`. The card offers email and password (`Sign in`, or `Create account` after `Create an account`), plus Google and Apple when the server enables them. A failure shows a short red message in the card, such as `Wrong email or password`, `Could not sign in`, or `Could not reach the server`.

## Sub-features

- `signin-logo` shows the bare sloth logo above the card.
- `signin-email` signs in or creates an account with email and password and opens the Inbox.
- `signin-error` shows why sign-in failed. iOS DEBUG builds print the full detail (request, status, response body, or the underlying error) in small monospaced text under the message, and every iOS error goes to the unified log under category `errors`.

## How to get to it (user POV)

- Web: open the app in a fresh browser profile.
- iOS: launch with `PROCRASTIMATE_RESET=1` and no Keychain session.

## Driving it

- Web: `e2e/auth.e2e.ts` waits for the `ProcrastiMate` heading, signs up, and lands on the Inbox.
- iOS: `SIMCTL_CHILD_PROCRASTIMATE_RESET=1 xcrun simctl launch <udid> com.stefan.procrastimate`, then take a screenshot. To see `signin-error`, build Debug with `API_URL=http:/$()/127.0.0.1:1`: the card shows `Could not reach the server` and the `NSURLErrorDomain Code=-1004` detail under it. Watch the log with `xcrun simctl spawn <udid> log stream --level error --predicate 'category == "errors"'`.
