# LTS (as of 2024/03)
FROM node:20

# Set production env
ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

# Copy package[-lock].json to install dependencies
COPY package*.json ./
RUN npm ci && npm cache clean --force

# Copy everything else over
COPY . .

# Listen on 3232
EXPOSE 3232

# Let the app know we're in a Docker environment
ENV IS_DOCKER=1

# Ensure the main /Data directory exists, which is where the
# config and backup database will be stored.
RUN mkdir /Data

VOLUME [ "/Data" ]

# Run the app
CMD [ "node", "app.js" ]
