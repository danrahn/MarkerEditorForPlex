# LTS
FROM node:16

# Copy package[-lock].json to install dependencies
COPY package*.json ./
RUN npm install

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
