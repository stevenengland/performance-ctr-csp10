# Provisional host stand-in: PHP 8.3 with Apache until the host probe (#2) pins
# the real PHP version (slice 1/4 replaces the tag with the findings).
FROM php:8.3-apache
RUN docker-php-ext-install pdo_mysql \
 && a2enmod rewrite headers \
 && a2dissite 000-default
COPY performance.conf /etc/apache2/sites-available/performance.conf
RUN a2ensite performance
