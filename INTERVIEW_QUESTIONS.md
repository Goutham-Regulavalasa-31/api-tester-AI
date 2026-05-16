# DevIQ — API Tester: Interview Questions

---

## Feature 1: API Request Builder

1. **What is the difference between GET, POST, PUT, PATCH, and DELETE HTTP methods? When would you use each?**
   > GET = fetch data, POST = create, PUT = full update, PATCH = partial update, DELETE = remove. Use GET for reads (no body), POST when creating a new resource, PUT when replacing an entire resource, PATCH for partial edits.

2. **What is CORS and why did you need to configure it in your FastAPI backend?**
   > CORS (Cross-Origin Resource Sharing) is a browser security rule that blocks requests from one origin (localhost:3000) to a different origin (localhost:8000) unless the server explicitly allows it. We added `CORSMiddleware` in FastAPI to whitelist our frontend.

3. **What is the difference between a request header and a request body?**
   > Headers carry metadata about the request (auth tokens, content type, format). The body carries the actual data payload — only applicable in POST/PUT/PATCH. GET requests have no body.

4. **What is `useState` in React and why did you use it in the Request Builder?**
   > `useState` is React's way of storing values that change over time. When state changes, React re-renders the component. We used it to track the URL, method, headers, body, loading state, and response — every dynamic piece of the UI.

5. **What does `"use client"` mean at the top of the Next.js page?**
   > It tells Next.js to render this component on the browser (client-side), not on the server. We needed it because we use browser APIs like `useState` and `axios` — which don't exist on the server.

6. **What is a Pydantic model in FastAPI and why is it important?**
   > Pydantic models define the expected shape of incoming request data. FastAPI automatically validates the request body against the model and returns a clear 422 error if data is missing or wrong. It's like a contract between frontend and backend.

7. **Why did you use `httpx` in the FastAPI backend instead of Python's built-in `requests` library?**
   > `httpx` supports `async/await`, which means FastAPI can handle multiple requests concurrently without blocking. The `requests` library is synchronous and would block the server while waiting for a response.

8. **What is response time and why does it matter in API testing?**
   > Response time is how long the server took to respond (in milliseconds). In API testing it matters for performance benchmarking — a slow API degrades user experience. SLAs (Service Level Agreements) often define acceptable thresholds (e.g., < 200ms).

9. **What HTTP status codes would you consider a success, and which would be failures?**
   > 2xx = success (200 OK, 201 Created, 204 No Content). 3xx = redirects. 4xx = client errors (400 Bad Request, 401 Unauthorized, 404 Not Found). 5xx = server errors (500 Internal Server Error). In testing, 2xx is typically the expected passing range.

10. **What is TypeScript and why is it preferred over plain JavaScript for a project like this?**
    > TypeScript adds static types to JavaScript — you define what shape data should be (like our `Header` interface and `APIResponse` interface). This catches bugs at compile time instead of runtime and makes code easier to maintain and document.

11. **What is `async/await` and how did you use it in the `sendRequest` function?**
    > `async/await` is syntax for handling asynchronous operations (things that take time, like network calls) without blocking the UI. `await axios.post(...)` waits for the backend response before continuing, while the UI remains interactive.

12. **Why did you parse the response body with `JSON.parse` before displaying it, and what happens if it fails?**
    > We pretty-print JSON with 2-space indentation using `JSON.stringify(JSON.parse(raw), null, 2)`. If the body is not JSON (e.g., plain text or HTML), `JSON.parse` throws — we catch that and display the raw string instead.

13. **What is the difference between query parameters and request body? Give an example.**
    > Query params are appended to the URL: `GET /users?page=1&limit=10` — visible, cacheable, no body. Request body sends data in the HTTP payload: `POST /users` with `{"name": "John"}` — used for sensitive or large data. GET uses params; POST/PUT use body.

14. **What is a REST API and what makes an API "RESTful"?**
    > REST (Representational State Transfer) is an architectural style. A RESTful API uses: standard HTTP methods (GET/POST/PUT/DELETE), stateless requests (each request is self-contained), resource-based URLs (`/users/123` not `/getUser`), and returns structured data (usually JSON).

15. **In your tool, how does the frontend know whether a response was successful or not without hard-coding every status code?**
    > The backend computes `success = 200 <= status_code < 300` and returns it as a boolean. The frontend uses that flag plus the `statusColor()` helper which maps status ranges to colors. This range-check approach handles all standard HTTP success codes without enumerating them.

---

## Feature 2: Request History

1. **What is `localStorage` and how does it differ from `sessionStorage` and cookies?**
   > `localStorage` persists data in the browser with no expiry — it survives tab closes and browser restarts. `sessionStorage` clears when the tab is closed. Cookies are sent to the server on every request (adding network overhead) and have a ~4KB size limit. `localStorage` is ideal for client-side-only data like request history that doesn't need the server to see it.

2. **Why must `localStorage` access live inside a `useEffect`, not directly in the component body?**
   > Next.js renders components on the server first (SSR). The server has no browser APIs — `localStorage` doesn't exist there and would throw a ReferenceError. `useEffect` only runs in the browser after the component mounts, so it's the safe place for any browser-specific API call.

3. **What is `useEffect` and when does it run?**
   > `useEffect` is React's escape hatch for side effects — things that happen outside the render cycle (fetching data, reading localStorage, setting up subscriptions). With an empty dependency array `[]`, it runs exactly once after the component first mounts in the browser. With dependencies like `[count]`, it re-runs whenever `count` changes.

4. **Why did you use the functional form of `setState` (`setHistory(prev => ...)`) in `saveToHistory`?**
   > React state updates are asynchronous — if you read `history` directly inside the updater, you might get a stale snapshot from the closure at the time the function was created. The functional form receives the actual latest state as `prev`, guaranteed to be current. This matters especially for operations like prepending an item or slicing the array.

5. **How did you limit history to 50 entries and why cap it at all?**
   > After prepending the new entry: `[entry, ...prev].slice(0, MAX_HISTORY)`. `slice(0, 50)` keeps only the first 50 items (most recent). The cap prevents `localStorage` from growing unboundedly — browsers enforce a ~5MB quota per origin; storing thousands of large JSON responses would eventually hit it and throw a `QuotaExceededError`.

6. **What does `e.stopPropagation()` do in the delete button handler?**
   > The delete `<button>` is nested inside the history row `<button>`. Without `stopPropagation()`, clicking delete would bubble up to the parent button and trigger `loadFromHistory` as well — loading a request you just tried to delete. `stopPropagation()` stops the click event from traveling up the DOM tree past the delete button.

7. **How does clicking a history entry restore the full form state?**
   > `loadFromHistory` calls `setMethod`, `setUrl`, `setHeaders`, `setBody`, and `setResponse` — one setter per piece of state. Because each of those is a React state variable, setting them triggers a re-render with the restored values, and the UI reflects the old request exactly as if the user had typed it.

8. **What is a unique ID and why does each history entry need one?**
   > React needs a stable, unique `key` prop to identify list items during re-renders — without it, it can't tell which item was removed and may re-order or corrupt the list. We generate one with `Date.now() + Math.random()` (a timestamp + random suffix). UUIDs (`crypto.randomUUID()`) are the more robust production alternative.

9. **What is `JSON.stringify` / `JSON.parse` and why do you need both for localStorage?**
   > `localStorage` can only store strings. `JSON.stringify` serializes a JavaScript array/object into a JSON string for storage. `JSON.parse` deserializes it back into a JavaScript array on read. Without stringify, you'd store `[object Object]`; without parse, you'd get back a raw string instead of a usable array.

10. **What would happen if `JSON.parse` throws when reading history from localStorage?**
    > We wrap it in a `try/catch` and silently ignore the error. This handles corruption from a browser extension, a manual edit in DevTools, or a schema change between app versions. The app continues working with an empty history rather than crashing.

---

## Feature 3: Collections / Saved Requests

1. **How did you model the relationship between a Collection and a SavedRequest?**
   > A `Collection` has an `id`, `name`, and a `requests` array of `SavedRequest` objects. This is a one-to-many relationship stored as nested objects — one collection contains many requests. It's the simplest model that supports grouping without needing a relational database or foreign keys.

2. **Why did you use `"__new__"` as a sentinel value in the collection dropdown? What is a sentinel value?**
   > A sentinel is a special value that signals a distinct state rather than real data — here, `"__new__"` in the `saveCollectionId` dropdown means "the user wants to create a new collection" rather than select an existing one. It avoids needing a separate boolean flag like `isCreatingNew`, keeping the condition in one place: `if (saveCollectionId === "__new__")`.

3. **How do you update a nested item in an array of objects without mutating state directly?**
   > With `.map()`: iterate the collections array and, for the matching collection, return a new object with the updated `requests` array — `{ ...col, requests: [...col.requests, req] }`. All other collections are returned unchanged. This produces a brand-new array reference, which tells React something changed and triggers a re-render. Direct mutation (`col.requests.push(req)`) would not trigger re-renders because the array reference stays the same.

4. **What is a JavaScript `Set` and why did you use it for `expandedCollections`?**
   > A `Set` is a collection of unique values with O(1) `has`, `add`, and `delete`. We need to track which folder IDs are open — a natural fit for a Set because IDs are unique and we only care about membership, not order. Using an array would require `.includes()` (O(n)) and manual deduplication.

5. **Why do you call `setExpandedCollections` inside `setCollections`'s callback when creating a new collection?**
   > When creating a new collection, its `id` is generated inside the `setCollections` callback (using `Date.now()`). To auto-expand it in the sidebar, we need that ID — and it only exists at that point. Calling `setExpandedCollections` from inside the callback gives us access to the just-created `col.id` before it escapes scope.

6. **Why does `toggleCollectionExpand` use `new Set(prev)` instead of mutating `prev` directly?**
   > React's state must be treated as immutable. Mutating `prev` directly (`prev.add(id)`) modifies the existing Set object and React sees the same reference — no re-render occurs. `new Set(prev)` creates a copy first, so the reference changes, signaling React to re-render.

7. **What does the `URL` constructor do in `defaultRequestName`, and why wrap it in `try/catch`?**
   > `new URL(string)` parses a URL string into its components (`.pathname`, `.hostname`, `.searchParams`, etc.). It throws a `TypeError` if the string isn't a valid URL — for example, if the user hasn't finished typing. The `try/catch` catches that and falls back to a generic name instead of crashing.

8. **What does `autoFocus` do on the save-dialog name input?**
   > `autoFocus` moves keyboard focus to that input element as soon as it renders. Without it, the user would have to click into the field manually. Combined with the `Enter` key triggering `saveRequest`, the full save flow becomes keyboard-only: click Save, type a name, press Enter.

9. **How does the sidebar's `sidebarTab` state replace the old `showHistory` boolean, and why is that better?**
   > `showHistory: boolean` only modelled two states: open or closed. Adding a second panel would require a second boolean (`showCollections`), but then both could be `true` at once — invalid UI state. `sidebarTab: "history" | "collections" | null` is a discriminated union that encodes all three legal states (history open, collections open, closed) in a single value, making illegal combinations impossible.

10. **What is `e.stopPropagation()` doing in `deleteCollection` and `deleteSavedRequest`?**
    > Both delete buttons are nested inside a parent `<button>` (the folder/request row). Without `stopPropagation()`, a click on the delete button would bubble up and also trigger the parent's `onClick` — loading or toggling the item you just deleted. `stopPropagation()` stops the event at the delete button so the parent never sees it.

---

## Feature 4: Environment Variables

1. **What is string interpolation / variable substitution and why is it useful in API testing?**
   > Variable substitution replaces placeholders like `{{baseUrl}}` with real values at use time. In API testing this means you define a base URL once (e.g. `https://api.staging.example.com`) and reuse it across dozens of requests — change it in one place and every request updates. Without it you'd have to edit every URL manually when switching environments.

2. **What is a regular expression (regex)? Break down `/\{\{(\w+)\}\}/g`.**
   > A regex is a pattern that matches text. Breakdown of `\{\{(\w+)\}\}/g`:
   > - `\{\{` — matches literal `{{` (braces need escaping because `{` has special regex meaning)
   > - `(\w+)` — a capture group: matches one or more word characters (letters, digits, underscore) — this captures the variable name
   > - `\}\}` — matches literal `}}`
   > - `g` flag — global: replace ALL matches in the string, not just the first one

3. **What is a capture group in a regex, and how did you use it in `applyEnv`?**
   > A capture group is a part of the pattern wrapped in `()`. When `.replace()` is called with a function, the function receives the full match as the first argument and each captured group as subsequent arguments. We use the second argument (`key`) to look up the variable name in the `envVars` array.

4. **Why does `applyEnv` leave unresolved placeholders as-is instead of replacing them with an empty string?**
   > Replacing with empty string would silently corrupt the URL — `https://{{baseUrl}}/users` would become `https:///users`, producing a confusing error. Leaving `{{baseUrl}}` intact makes the problem visible: the user sees exactly which variable is missing. It's the principle of failing loudly rather than silently.

5. **Why don't you mutate the `url`, `headers`, and `body` state when substituting variables?**
   > If we substituted into the state directly, the user would lose their `{{placeholders}}` — they'd have to retype them to use the template again. Separating the template (what the user types, stored in state) from the resolved value (used only at send time) means you can change env vars and resend without re-entering anything. This is the same pattern as a template engine like Handlebars.

6. **What is a derived value in React and how did you use it for `resolvedUrlPreview`?**
   > A derived value is computed from existing state on every render — it's not stored in its own `useState` hook because it can always be recalculated. `resolvedUrlPreview = url.includes("{{") ? applyEnv(url, envVars) : ""` is derived from `url` and `envVars`. Storing it in state would require `useEffect` to keep it in sync — unnecessary complexity when a plain variable works.

7. **Why did you create a `persistEnv` helper instead of writing `setEnvVars` + `localStorage.setItem` everywhere?**
   > The two operations always happen together — any time env vars change, both state and localStorage must update. Extracting them into `persistEnv` removes the duplication and ensures they can't accidentally diverge (e.g. updating state but forgetting localStorage). It also gives the pattern a name that documents intent.

8. **What is the generic `load` helper in `useEffect` doing, and what does `<T,>` mean?**
   > `load<T>(key, setter)` is a small generic function that reads a key from localStorage, parses it, and calls a setter. The `<T,>` syntax (with the trailing comma to avoid JSX ambiguity) is a TypeScript generic — it lets the same function work for `HistoryEntry[]`, `Collection[]`, and `EnvVariable[]` without repeating the try/catch three times.

9. **What is `sentUrl` and why is it separate from `resolvedUrlPreview`?**
   > `resolvedUrlPreview` is a derived value shown live in the URL bar while the user types — it reflects the current state. `sentUrl` is a piece of state saved after the request is sent — it reflects what was actually sent. They often differ: the user might edit the URL after sending without sending again. Showing `sentUrl` in the response tab is accurate history; showing `resolvedUrlPreview` there would show the current (possibly unsent) URL.

10. **What would happen if two environment variables have the same key?**
    > `Array.prototype.find` returns the first match, so the first enabled variable with that key wins. This is consistent but silently ignores the duplicate. A more robust implementation would validate for duplicate keys when the user types, highlighting the conflict with a warning. For now the behavior is predictable even if not ideal.

---

## Feature 5: Authentication Helpers

1. **What are the three most common HTTP authentication schemes, and how does each work?**
   > **Bearer Token** (OAuth 2.0 / JWT): The client sends a token it received from an auth server — `Authorization: Bearer <token>`. The server validates the token and grants access without needing a password again. **Basic Auth**: The client encodes `username:password` in Base64 and sends `Authorization: Basic <base64>`. **API Key**: A long secret string sent in a custom header (e.g. `X-API-Key: abc123`) or as a query parameter. Bearer/Basic use the standardized `Authorization` header; API Key uses whatever header the API defines.

2. **What is Base64 encoding? Is it encryption? Why does Basic Auth use it?**
   > Base64 converts arbitrary bytes into a string of 64 printable ASCII characters (A–Z, a–z, 0–9, +, /). It is NOT encryption — it's reversible with no key: `atob("dXNlcjpwYXNz")` decodes instantly. HTTP headers must be ASCII; Base64 ensures `username:password` (which might contain non-ASCII characters) survives transmission. Basic Auth must always run over HTTPS — without TLS the Base64 is visible to anyone on the network.

3. **What is `btoa()` and what is its counterpart? What does the name mean?**
   > `btoa("string")` encodes a Latin-1 string to Base64. The reverse is `atob("base64")`, which decodes. The names are historical: **b**inary **to** **a**SCII and **a**SCII **to** **b**inary. Both are browser globals (and available in Node 18+). `btoa` throws if the input contains characters outside the Latin-1 range (code points > 255) — that's why the Basic Auth preview wraps it in `try/catch`.

4. **What is `Object.assign(target, source)` and how did you use it to inject the auth header?**
   > `Object.assign(target, source)` copies all enumerable own properties from `source` into `target`, mutating `target`. We call it as `Object.assign(headersObj, buildAuthHeader(resolvedAuth))` — which merges the auth header into the already-built headers object. Because `Object.assign` runs after `headersObj` is populated from the Headers tab, the auth header wins over any manually set duplicate key.

5. **Why is auth applied AFTER env-var substitution rather than before?**
   > Auth fields can reference env vars — e.g. `token: "{{myToken}}"`. If we built the auth header first, the placeholder would be sent literally. Resolving env vars first means `buildAuthHeader` receives the actual token value. The order is: resolve env → build headers from tab → inject auth header.

6. **Why use a `switch` statement in `buildAuthHeader` rather than a chain of `if/else`?**
   > `switch` is idiomatic when dispatching on a single variable with a fixed set of known cases. It makes the branching intent immediately clear and scales cleanly as you add more auth types. Each `case` is self-contained. With `if/else`, readers must parse the condition in each branch to know what's being compared — `switch` puts `auth.type` at the top and the values at the `case` labels, which is easier to scan.

7. **Why store `showAuthPassword` in component state instead of a `<input type>` attribute?**
   > The `type` attribute on an `<input>` can't be changed dynamically in the way React works — React controls the rendered output. By storing a boolean in `useState`, toggling it causes a re-render where React renders `type="text"` or `type="password"`. The Eye/EyeOff icon button's `onClick` just flips the boolean; React handles the rest.

8. **Why does `updateAuthConfig` accept `field: keyof AuthConfig` but type `value` as `string`, even though `type` is a union?**
   > In TypeScript, `keyof AuthConfig` gives the union of all property names. At runtime, the function receives a string value for `field` and a string for `value`. Since all `AuthConfig` fields that we update through the UI are strings (even `type` is a string union), typing `value` as `string` is correct — TypeScript won't complain because we spread the update into the existing object, which is already typed.

9. **Why did you show the actual live Base64 output in the Basic Auth preview instead of just saying "base64-encoded"?**
   > Showing the real value (`Authorization: Basic dXNlcjpwYXNz`) is educational — it demonstrates that Base64 is not encryption, and the user can copy/paste it into a JWT debugger or `atob()` in the console to see it decode back to `username:password`. It also serves as a debugging aid: if auth fails, the user can see exactly what header was sent.

10. **What is the green dot indicator on the Auth tab and why is it a better UX pattern than always showing text?**
    > `authConfig.type !== "none"` renders a small `w-1.5 h-1.5 rounded-full bg-green-400` dot inside the tab label. It signals at a glance that auth is configured without adding text that clutters the tab bar. This follows the principle of *progressive disclosure* — show the detail (which auth type) only when the user opens the tab, but indicate presence with a minimal visual cue at all times.

---

## Feature 6: Test Assertions

1. **What is a test assertion in the context of API testing?**
   > An assertion is a statement that must be true after a request completes. If it isn't, the test fails. Examples: "status must be 200", "response time must be under 500ms", "body.id must exist". Assertions turn manual eyeballing into automated verification — you can run the same request 100 times and know instantly if anything broke, without reading the response yourself.

2. **What is a DSL (Domain-Specific Language)? Did you build one?**
   > A DSL is a small language designed for a specific problem domain rather than general-purpose programming. We built a minimal one: `status == 200`, `body.user.id exists`, `header.content-type contains json`. It's not Turing-complete — it can only express one kind of statement (assertions against a response). Postman's test scripts use JavaScript; our DSL trades power for simplicity and learnability.

3. **How does `resolveSubject` traverse a nested JSON path like `body.user.address.city`?**
   > It splits the path string by `.` into `["user", "address", "city"]`, then iterates with a `for...of` loop, indexing into the current object at each key: `cur = cur[key]`. If `cur` is ever `null` or not an object, it returns `undefined` early. This is manual dot-notation traversal — no library needed.

4. **What does `JSON.parse(raw)` do in `coerceValue`, and why does falling back to the raw string matter?**
   > `JSON.parse("200")` returns the number `200`. `JSON.parse("true")` returns the boolean `true`. `JSON.parse("null")` returns `null`. `JSON.parse("John Doe")` throws — because it's not valid JSON — so we catch that and return the raw string `"John Doe"`. This single function handles numbers, booleans, null, and strings automatically without separate `if` branches.

5. **Why does the `==` assertion use `String(actual) === String(expected)` as a fallback?**
   > After `JSON.parse` coercion, `actual` might be the number `1` while the user wrote `body.id == 1` — strict `===` would fail if `id` came back as the string `"1"` from the API. Converting both to strings (`"1" === "1"`) gives the intuitive result. This is a deliberate choice to be forgiving: API responses sometimes return numbers as strings depending on serialization.

6. **Why do lines starting with `#` get filtered out before running assertions?**
   > They're comments. Filtering them with `.filter(l => !l.startsWith("#"))` lets users annotate their test scripts — e.g. `# Check that the response is fast`. Without this filter, the engine would try to parse `# Check...` as an assertion, fail to find a valid subject, and report an error for every comment line.

7. **Why are the assertion engine functions (`resolveSubject`, `coerceValue`, `runAssertion`, `runAssertions`) defined outside the component, not inside it?**
   > They are pure functions — they take inputs and return outputs with no side effects, no state, and no dependency on React. Defining them outside the component means they're created once at module load, not re-created on every render. They're also easier to unit test in isolation: `runAssertion("status == 200", mockResponse)` works without any React setup.

8. **What is `tokens.slice(2).join(" ")` doing in `runAssertion`, and why is it needed?**
   > Splitting `"body.name == John Doe"` by whitespace gives `["body.name", "==", "John", "Doe"]`. The value is the everything after the operator, which may contain spaces. `.slice(2)` drops the subject and operator, leaving `["John", "Doe"]`. `.join(" ")` reassembles them: `"John Doe"`. Without this, multi-word string values would be truncated to the first word.

9. **How did you display the test summary in two places (tab badge + response tab) without duplicating logic?**
   > `testsPassed`, `testsTotal`, and `allTestsPassed` are derived values computed once from `testResults` state. Both the tab bar and the response tab read those same derived values — there's no duplication. React re-renders both places whenever `testResults` changes.

10. **When you call `setTestResults([])` at the start of `sendRequest`, why clear the previous results first?**
    > Old results belong to the previous response. If you leave them visible while the new request is in-flight, the UI shows stale pass/fail rows that don't correspond to anything. Clearing them immediately makes the "stale state" window zero — the tab shows no results until the new request completes and new assertions run. This is the principle of never showing data that doesn't correspond to the current state.

---

---

## Feature 7: App-Level Authentication (Login / Register)

1. **What is a JWT (JSON Web Token)? What are its three parts?**
   > A JWT is a compact, self-contained token used to prove identity. It has three Base64url-encoded parts separated by dots: **Header** (algorithm + token type, e.g. `{"alg":"HS256","typ":"JWT"}`), **Payload** (claims — data the server asserts, e.g. `{"sub":"42","exp":1720000000}`), and **Signature** (HMAC of header + payload using a secret key). The server verifies the signature — if it's valid, the payload is trusted without a database lookup.

2. **What is the difference between authentication and authorization?**
   > **Authentication** asks "who are you?" — it verifies identity (login with username/password, token validation). **Authorization** asks "what are you allowed to do?" — it checks permissions after identity is established (e.g. can this user delete other users' data?). In DevIQ, authentication is the login flow; authorization is the backend checking that the JWT's `user_id` matches the resource being accessed.

3. **Why do we hash passwords with bcrypt instead of storing them as plain text or using MD5/SHA-256?**
   > Storing plain text means a database leak exposes every password immediately. MD5/SHA-256 are fast — attackers can try billions of guesses per second with a GPU. bcrypt is intentionally slow (configurable cost factor) and automatically adds a random **salt** to each hash, so identical passwords produce different hashes and pre-computed rainbow tables become useless. Even if DevIQ's database were stolen, bcrypt hashes would be impractical to crack at scale.

4. **What is a salt in password hashing, and what problem does it solve?**
   > A salt is a random value generated per-password and appended (or prepended) before hashing. `passlib` handles this automatically. Without salts, two users with the same password produce the same hash — an attacker who cracks one cracks both. With salts, `hash("password" + "a1f3...")` and `hash("password" + "z9b2...")` produce completely different outputs, defeating pre-computation attacks and making each hash independent.

5. **What is SQLAlchemy and why use an ORM instead of raw SQL?**
   > SQLAlchemy is a Python ORM (Object-Relational Mapper) — it maps Python classes to database tables and Python objects to rows. `User(username="alice")` instead of `INSERT INTO users (username) VALUES ('alice')`. Benefits: automatic query building, protection against SQL injection by default (parameterized queries), database portability (swap SQLite for Postgres by changing one URL), and Python-native type checking. The downside is an abstraction layer that can hide performance issues for complex queries.

6. **What is FastAPI's `Depends` system? How does `get_current_user` use it?**
   > `Depends` is FastAPI's dependency injection system — it declares that a route needs something computed before it runs, and FastAPI wires it up automatically. `get_current_user` is a function that reads the `Authorization` header, decodes the JWT, queries the database for the user, and returns the `User` object. Any route that declares `current_user: User = Depends(get_current_user)` gets that user injected without repeating the auth logic. If the token is invalid, `get_current_user` raises a 401 and FastAPI never calls the route handler.

7. **Explain the `get_db` generator pattern. Why use `yield` instead of `return`?**
   > `get_db` uses `yield` to create a context-manager-like dependency: it opens a SQLAlchemy session, yields it to the route handler, then the code after `yield` (in `finally`) closes the session — even if the handler raised an exception. With `return`, there's no hook for cleanup. The `yield` pattern guarantees the session is always closed, preventing connection leaks. FastAPI calls the generator, injects the yielded value, then drives the generator to completion after the response is sent.

8. **Why does the SQLite engine need `check_same_thread=False`?**
   > SQLite's default behavior refuses connections used across multiple threads (it's not thread-safe by default). FastAPI uses a thread pool to handle concurrent requests — each request may run on a different thread but share the same `engine`. `check_same_thread=False` disables that guard. It's safe here because SQLAlchemy manages its own connection pool and session lifecycle, ensuring each request gets its own session object and concurrent writes are serialized at the SQLite level.

9. **Why are `deviq_token` and `deviq_username` still in `localStorage` while all other app data moved to the backend?**
   > The token and username are **credentials needed to make any backend request** — they must be available before any API call can happen. Storing them in the backend would create a chicken-and-egg problem: you'd need the token to fetch the token. `localStorage` is the right place for authentication state that lives in the browser session. All other data (history, collections, env vars) moved to the backend so it's accessible across browsers and devices — credentials are inherently device-local by design.

10. **What is `Promise.all` and why did you use it to load initial data instead of sequential `await` calls?**
    > `Promise.all([p1, p2, p3, ...])` starts all promises in parallel and resolves when every one completes (or rejects immediately if any one fails). Sequential `await` calls would fire one request, wait for the response, then fire the next — wasting time. With `Promise.all`, all five data-fetch requests (history, collections, env vars, auth config, test script) go out simultaneously. On a backend with ~10ms round-trips each, sequential would take ~50ms; parallel takes ~10ms (the slowest response).

11. **What does "fire-and-forget" mean in `saveData`, and what are its trade-offs?**
    > Fire-and-forget means starting an async operation without `await`-ing it or handling its result. `saveData` calls `axios.put(...)` without `await` — the UI doesn't wait for the save to confirm before continuing. Trade-off: the UI is instantly responsive (no spinner on every keystroke that changes data), but if the network request fails, the user won't know. We mitigate this with `.catch(() => {})` to silence unhandled promise rejections. For a dev tool where data loss is inconvenient but not catastrophic, this trade-off is acceptable. A production app might queue retries or show a subtle error indicator.

12. **What is the `loading` / `dataLoaded` pattern in the main page and why is it necessary?**
    > On mount, the component redirects to `/login` if there's no token, or fires `Promise.all` to load data. During that time, `dataLoaded` is `false` and the component renders a loading screen instead of the full UI. Without this guard, the UI would render with empty state (no history, no collections) for a flash before data arrives — users would see blank lists that suddenly populate, and any `useEffect` that depends on loaded data could run with wrong values. The loading gate ensures the UI is only shown once it's ready.

---

*All seven features are complete. The project covers: Request Builder · History · Collections · Environment Variables · Auth Helpers · Test Assertions · App Authentication.*
