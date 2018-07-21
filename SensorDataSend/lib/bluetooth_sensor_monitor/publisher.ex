defmodule BluetoothSensorMonitor.Publisher do
  @moduledoc false
  @module __MODULE__

  require Logger

  use GenServer

  alias BluetoothSensorMonitor.API.Client, as: APIClient

  def start_link(_) do
    GenServer.start_link(@module, nil, name: @module)
  end

  @impl true
  def init(_) do
    {:ok, nil}
  end

  def publish(data) do
    GenServer.cast(@module, {:publish, data})
  end

  @impl true
  def handle_cast({:publish, data}, state) do
    do_publish(data)

    {:noreply, state}
  end

  defp do_publish(data) do
    with host = System.get_env("BSM_NOTIFICATIONS_HOST") || "localhost",
         port when port !== nil <- System.get_env("BSM_NOTIFICATIONS_PORT"),
         {port, ""} <- Integer.parse(port),
         path = System.get_env("BSM_NOTIFICATIONS_PATH") || "/" do
      do_publish(data, host, port, path)
    end
  end

  defp do_publish(data, host, port, path) do
    url = "http://#{host}:#{port}#{path}"

    publishing_result = {data, APIClient.post_data(data, url)}

    Logger.debug("[PUBLISHED VALUES] #{inspect(publishing_result)}")

    publishing_result
  end
end
