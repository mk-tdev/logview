# Publishing Logview Local to npm

The public npm package is **`logview-local`**. Its installed command is also **`logview-local`**. The source repository is [mk-tdev/logview](https://github.com/mk-tdev/logview).

## Release

Sign in to an npm account with publishing access. The initial publisher is **`mktdev`**; npm and GitHub usernames are separate.

```sh
npm login
npm whoami
```

From a clean source checkout:

```sh
npm run check
npm test
npm run test:package
npm pack --dry-run
npm publish --access public
```

The `prepublishOnly` hook runs syntax checks, integration tests, and the isolated global-install smoke test. The tarball includes only the launcher, capture modules, browser assets, sample app, and package documentation. It excludes screenshots, test output, repository metadata, and credentials.

npm may require browser verification or an OTP. Complete that through npm's sign-in or publishing flow. Never commit `.npmrc` or tokens.

Verify the public release:

```sh
npm view logview-local version
npm install -g logview-local
logview-local --version
logview-local demo
```

For later releases, update `CHANGELOG.md`, run `npm version patch` (or `minor` / `major` as appropriate), push the commit and tag, then run `npm publish --access public`. Published versions cannot be reused.

The GitHub source can also be installed directly:

```sh
npm install -g github:mk-tdev/logview
```
