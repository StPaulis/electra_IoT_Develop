defmodule BluetoothSensorMonitor.Application do
  @moduledoc false

  require BluetoothSensorMonitor

  BluetoothSensorMonitor.config(:require_file)

  use Application

  def start(_type, _args) do
    import Config

    BluetoothSensorMonitor.config(:load_file)

    localhost_listen_port = config().localhost_listen_port

    children = [
      BluetoothSensorMonitor.Events,
      BluetoothSensorMonitor.State,
      BluetoothSensorMonitor.Publisher,
      Plug.Adapters.Cowboy.child_spec(
        scheme: :http,
        plug: BluetoothSensorMonitor.API,
        options: [port: localhost_listen_port]
      ),
      BluetoothSensorMonitor.Scanner,
      BluetoothSensorMonitor.Controller,
      BluetoothSensorMonitor.Monitor
    ]

    opts = [strategy: :one_for_one, name: BluetoothSensorMonitor.Supervisor]

    Supervisor.start_link(children, opts)
  end
end
