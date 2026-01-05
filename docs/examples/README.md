# Widget examples

- `widget-test.html` — local test page for public widgets.

Run a static server on port 8080 so `Origin` matches your allowlist:

```bash
npx serve docs/examples -l 8080
# then open:
# http://localhost:8080/widget-test.html
```

Before testing, set:
- `data-project-slug`
- `data-project-key`
- (optional) ensure `http://localhost:8080` is in allowed origins for the project.
