FROM registry.gitlab.com/sadesyllas/raspberrypi3-fedora-elixir:20.3.8-1.6.5

ENV LANG=en_US.UTF-8

WORKDIR /home

ADD . /home

RUN mix local.hex --force && mix local.rebar --force && mix deps.get

CMD iex -S mix
