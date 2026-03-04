#!/usr/bin/env python3
"""Fix nginx to allow plain HTTP for /api/releases/latest (Win7 TLS compatibility).

Certbot's port-80 server block does `if ($host) { return 301 https://... }` which
runs at rewrite phase BEFORE location blocks. We use set+if variable stacking to
skip the redirect for the releases endpoint.

NOTE: Certbot modified sites-enabled/usurper directly (not a symlink to sites-available).
"""

CONF = '/etc/nginx/sites-enabled/usurper'

with open(CONF) as f:
    content = f.read()

old_block = """\
server {
    if ($host = usurper-reborn.net) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80 default_server;
    server_name usurper-reborn.net play.usurper-reborn.net _;
    return 404; # managed by Certbot


}"""

new_block = """\
server {
    # Variable stacking: skip HTTPS redirect for plain HTTP version check API
    set $do_redirect "";
    if ($host = usurper-reborn.net) {
        set $do_redirect "yes";
    }
    if ($request_uri = /api/releases/latest) {
        set $do_redirect "";
    }
    if ($do_redirect) {
        return 301 https://$host$request_uri;
    }

    listen 80 default_server;
    server_name usurper-reborn.net play.usurper-reborn.net _;

    # Allow plain HTTP for version check API (Win7 TLS compatibility)
    location = /api/releases/latest {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        return 404;
    }
}"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open(CONF, 'w') as f:
        f.write(content)
    print("Done - nginx config updated with plain HTTP releases endpoint")
else:
    print("ERROR: Could not find certbot port-80 server block to replace")
    print("Dumping last 20 lines of config for debugging:")
    for line in content.splitlines()[-20:]:
        print(repr(line))
