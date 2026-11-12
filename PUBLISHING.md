# Publishing to npm

The package is configured as **`@mk-tdev/logview`**, with public access. The CLI installed by either npm or GitHub is named **`logview`**.

## First npm release

1. Sign in to the npm account that owns the `mk-tdev` scope:

   ```sh
   npm login
   npm whoami
   ```

   GitHub and npm accounts are separate. If your npm username is different, choose a scope you own and update `package.json` and the installation instructions before publishing.

2. From a clean checkout, validate and inspect the package:

   ```sh
   npm run check
   npm test
   npm run test:package
   npm pack --dry-run
   ```

3. Publish:

   ```sh
   npm publish --access public
   ```

   npm may require interactive verification or an OTP, depending on account settings. Complete that through npm's own sign-in flow; do not add tokens or `.npmrc` credentials to this repository. The `prepublishOnly` hook repeats the checks, integration tests, and real global-install smoke test before publishing.

4. Verify the public version:

   ```sh
   npm view @mk-tdev/logview version
   npm install -g @mk-tdev/logview
   logview --version
   logview demo
   ```

5. Update the README to make the npm registry command the primary installation option once publication is confirmed.

## Later releases

Update `CHANGELOG.md`, run `npm version patch` (or `minor` / `major` as appropriate), push the commit and tag, then run `npm publish --access public`. Each published version must have a unique version number.

Until a registry release exists, users can install the public repository directly with npm:

```sh
npm install -g github:mk-tdev/logview
```
