import bundleJs from "../../dist/bundle.js" with { type: "text" };
import stylesCss from "../../frontend/styles.css" with { type: "text" };

export { bundleJs, stylesCss };

export function buildHtml(actionToken: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="watcher-action-token" content="${actionToken}" /><!-- CSRF token: per-process nonce, safe for single-user local dashboard -->
<title>Watcher</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600&family=Fira+Code:wght@300;400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" integrity="sha384-PPIZEGYM1v8zp5Py7UjFb79S58UeqCL9pYVnVPURKEqvioPROaVAJKKLzvH2rDnI" crossorigin="anonymous" />
<link rel="stylesheet" href="/styles.css?v=${Date.now()}" />
</head>
<body>
<div id="root"></div>
<script src="/bundle.js?v=${Date.now()}"></script>
</body>
</html>`;
}
