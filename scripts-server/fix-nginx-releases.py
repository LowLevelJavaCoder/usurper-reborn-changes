#!/usr/bin/env python3
"""Fix the /api/releases/latest nginx location block to have proper variables."""
import re

CONF = '/etc/nginx/sites-available/usurper'

with open(CONF) as f:
    content = f.read()

# Remove the broken location block
old_block = re.search(r'    # Allow plain HTTP.*?\n    location = /api/releases/latest \{.*?\}', content, re.DOTALL)
if old_block:
    content = content[:old_block.start()] + content[old_block.end():]

# Find the port-80 server block with "listen 80 default_server" and add the location before the closing }
# The certbot block looks like:
#   server {
#     if ($host = ...) { return 301 ...; }
#     listen 80 default_server;
#     ...
#   }
new_location = """
    # Allow plain HTTP for version check API (Win7 TLS compatibility)
    location = /api/releases/latest {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
"""

# Insert after "listen 80 default_server;" line
content = content.replace(
    'listen 80 default_server;\n    server_name usurper-reborn.net play.usurper-reborn.net _;',
    'listen 80 default_server;\n    server_name usurper-reborn.net play.usurper-reborn.net _;\n' + new_location
)

with open(CONF, 'w') as f:
    f.write(content)

print("Done - nginx config updated")
