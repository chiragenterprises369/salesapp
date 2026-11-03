# Vistar database backups (change #20): pg_dump once a day (or every n hours), optional encryption, upload to S3
# or Bunny Storage, retention locally and remotely. Same major version as the database (postgres:17).
FROM postgres:17-alpine
RUN apk add --no-cache bash curl aws-cli openssl tzdata coreutils jq
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN sed -i 's/\r$//' /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh \
 && chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh \
 && mkdir -p /backups && chown postgres:postgres /backups
USER postgres
VOLUME ["/backups"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
