# The one-time setup tools, so none of them is installed on your machine:
# OpenTofu (the same version CI uses), the GitHub CLI and the AWS CLI.
# OpenTofu's own image refuses to be a base image, so its binary is copied from the minimal image.
FROM ghcr.io/opentofu/opentofu:1.10.10-minimal AS tofu

FROM alpine:3.22
RUN apk add --no-cache aws-cli github-cli git bash ca-certificates
COPY --from=tofu /usr/local/bin/tofu /usr/local/bin/tofu

WORKDIR /work
CMD ["bash"]
