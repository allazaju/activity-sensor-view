# Activity sensor -- remote view

The page that shows an activity sensor's snapshot on your phone when you are
away from home. It **holds no data and no keys**:

- the phone at home encrypts a snapshot (AES-256-GCM) and writes the
  ciphertext to a secret GitHub gist every five minutes;
- your link carries the key after the `#`, which a browser never sends to
  any server, and this page decrypts in your browser (WebCrypto);
- it loads nothing from any other host; its only request is for the
  ciphertext, from `gist.githubusercontent.com`.

Without a key in the link it shows nothing. This repository is a published
copy of `web/remote-view/` in the product's repository; changes are made
there and published with `tools/publish_viewer.py`.
