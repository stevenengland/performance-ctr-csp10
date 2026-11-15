# Host stand-in: Apache + mod_php with pdo_mysql, as on Strato. The PHP image is
# a PROVISIONAL pin (php:8.3-apache, PHP 8.3.36) until the host probe (#2)
# reports the host's version; see docs/runbook-deploy.md, "Runtime pins". The
# e2e stack, the deploy proof and the PHPUnit job all run on this image.
FROM php:8.3-apache@sha256:a800bbd2c0aa322702259ed475556b2cbc311076a8d3c4bba9bfe96838745472
RUN docker-php-ext-install pdo_mysql \
 && a2enmod rewrite headers \
 && a2dissite 000-default
COPY performance.conf /etc/apache2/sites-available/performance.conf
RUN a2ensite performance
