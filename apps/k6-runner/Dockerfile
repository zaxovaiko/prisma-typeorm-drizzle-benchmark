FROM grafana/k6:latest AS k6src

FROM alpine:3.20
RUN apk add --no-cache bash jq postgresql-client curl ca-certificates
COPY --from=k6src /usr/bin/k6 /usr/bin/k6
WORKDIR /app
COPY scenarios.js ./scenarios.js
COPY run.sh ./run.sh
RUN chmod +x run.sh
CMD ["./run.sh"]
