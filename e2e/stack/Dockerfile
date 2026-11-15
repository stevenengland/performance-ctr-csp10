# Host stand-in: Apache + PHP with pdo_mysql. PHP is pinned by digest to the host's
# version (php:8.5-apache, PHP 8.5.12, as probed on Strato; docs/runbook-deploy.md,
# "Runtime pins"). The e2e stack, the deploy proof, PHPUnit and the PHP static checks
# all run on this image. Strato runs PHP as FastCGI (cgi-fcgi); the official image
# only ships mod_php (built --disable-cgi), so nothing in .htaccess or the API may
# rely on mod_php (deploy/webspace/htaccess.test.ts, ADR 0004).
FROM php:8.5-apache@sha256:08af36df144462d84c7f16190557eec06cb9f656882685610b712a15eec54d46
RUN docker-php-ext-install pdo_mysql \
 && a2enmod rewrite headers \
 && a2dissite 000-default
COPY performance.conf /etc/apache2/sites-available/performance.conf
RUN a2ensite performance
