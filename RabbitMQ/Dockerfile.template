FROM resin/%%BALENA_MACHINE_NAME%%-debian

ADD rabbitmq.deb rabbitmq.deb

RUN groupadd -r rabbitmq 
RUN useradd -r -d /var/lib/rabbitmq -m -g rabbitmq rabbitmq

RUN apt-key adv --keyserver ha.pool.sks-keyservers.net --recv-keys 434975BD900CCBE4F7EE1B1ED208507CA14F4FCA

RUN echo 'deb http://packages.erlang-solutions.com/debian wheezy contrib' > /etc/apt/sources.list.d/erlang.list

RUN apt-get update && apt-get install -y apt-transport-https -y &&\
    apt-get install -y  --no-install-recommends
RUN logrotate curl ca-certificates \
    erlang erlang-mnesia erlang-public-key erlang-crypto erlang-ssl erlang-asn1 \
    erlang-inets erlang-os-mon erlang-xmerl erlang-eldap erlang-nox && \
    rm -rf /var/lib/apt/lists/*

RUN dpkg -i rabbitmq.deb

RUN rabbitmq-plugins enable rabbitmq_management

# get logs to stdout (thanks @dumbbell for pushing this upstream! :D)
ENV RABBITMQ_LOGS=- RABBITMQ_SASL_LOGS=-


# /usr/sbin/rabbitmq-server has some irritating behavior, and only exists to "su - rabbitmq /usr/lib/rabbitmq/bin/rabbitmq-server ..."
ENV PATH /usr/lib/rabbitmq/bin:$PATH

RUN echo '[{rabbit, [{loopback_users, []}]}].' > /etc/rabbitmq/rabbitmq.config

VOLUME /var/lib/rabbitmq

# add a symlink to the .erlang.cookie in /root so we can "docker exec rabbitmqctl ..." without gosu
RUN ln -sf /var/lib/rabbitmq/.erlang.cookie /root/

COPY docker-entrypoint.sh /

# saw following line in other repo (klaemo/docker-couchdb) to fix the "no permission" error
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]

EXPOSE 4369 5671 5672 25672
CMD ["rabbitmq-server"]
