server {
    server_name testapi.blenditjuice.com;

    client_max_body_size 25m;

    location / {
        # CORS is handled here at nginx so it works regardless of the Node build.
        # Strip any CORS headers coming from the Node upstream to avoid duplicate
        # "Access-Control-Allow-Origin" values (which browsers also reject).
        proxy_hide_header 'Access-Control-Allow-Origin';
        proxy_hide_header 'Access-Control-Allow-Methods';
        proxy_hide_header 'Access-Control-Allow-Headers';
        proxy_hide_header 'Access-Control-Allow-Credentials';
        proxy_hide_header 'Access-Control-Max-Age';

        # Preflight (OPTIONS) — answer directly with CORS headers, no upstream call.
        if ($request_method = 'OPTIONS') {
            add_header 'Access-Control-Allow-Origin' '*' always;
            add_header 'Access-Control-Allow-Methods' 'GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-Branch-Id, X-Branch-All' always;
            add_header 'Access-Control-Max-Age' 86400 always;
            add_header 'Content-Type' 'text/plain; charset=utf-8';
            add_header 'Content-Length' 0;
            return 204;
        }

        # Actual requests — attach CORS headers to the proxied response.
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-Branch-Id, X-Branch-All' always;

        proxy_pass http://127.0.0.1:7001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/testapi.blenditjuice.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/testapi.blenditjuice.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}
server {
    if ($host = testapi.blenditjuice.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name testapi.blenditjuice.com;
    return 404; # managed by Certbot


}
