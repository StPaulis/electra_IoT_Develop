defmodule BluetoothSensorMonitor.API do
  @moduledoc false

  require Logger

  use Plug.Router

  alias BluetoothSensorMonitor.State

  plug(:match)
  plug(:dispatch)

  put "/read_values" do
    Logger.debug("[API] setting BSM_READ_VALUES to true")

    System.put_env("BSM_READ_VALUES", "true")

    send_resp(conn, 200, "")
  end

  delete "/read_values" do
    Logger.debug("[API] setting BSM_READ_VALUES to false")

    System.put_env("BSM_READ_VALUES", "false")

    send_resp(conn, 200, "")
  end

  put "/read_values_interval" do
    {interval, conn} =
      case read_body(conn) do
        {_, interval, conn} -> {interval, conn}
        _ -> {nil, conn}
      end

    try do
      {_, ""} = Integer.parse(interval)

      Logger.debug("[API] setting BSM_READ_VALUES_INTERVAL to #{interval}")

      System.put_env("BSM_READ_VALUES_INTERVAL", interval)

      send_resp(conn, 200, "")
    rescue
      _ ->
        send_resp(conn, 422, "")
    end
  end

  get "/values" do
    values = Poison.encode!(State.get(), format_keys: :camel_case)

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, values)
  end

  post "/notifications" do
    {notifications, conn} =
      case read_body(conn) do
        {_, notifications, conn} -> {notifications, conn}
        _ -> {nil, conn}
      end

    try do
      with notifications when notifications !== nil <- notifications,
           {:ok, %{} = notifications} <- Poison.decode(notifications) do
        host = notifications |> Map.get("host", "") |> String.trim()

        if host === "" do
          Logger.debug("[API] resetting BSM_NOTIFICATIONS_HOST")

          System.delete_env("BSM_NOTIFICATIONS_HOST")
        else
          Logger.debug("[API] setting BSM_NOTIFICATIONS_HOST to #{host}")

          System.put_env("BSM_NOTIFICATIONS_HOST", host)
        end

        port = Map.get(notifications, "port", nil)

        if is_number(port) and port > 0 and port < 65536 do
          Logger.debug("[API] setting BSM_NOTIFICATIONS_PORT to #{port}")

          System.put_env("BSM_NOTIFICATIONS_PORT", to_string(port))
        else
          Logger.debug("[API] resetting BSM_NOTIFICATIONS_PORT")

          System.delete_env("BSM_NOTIFICATIONS_PORT")
        end

        path = notifications |> Map.get("path", "") |> String.trim()

        if path === "" do
          Logger.debug("[API] resetting BSM_NOTIFICATIONS_PATH")

          System.delete_env("BSM_NOTIFICATIONS_PATH")
        else
          Logger.debug("[API] setting BSM_NOTIFICATIONS_PATH to #{path}")

          System.put_env("BSM_NOTIFICATIONS_PATH", path)
        end

        proxy_host = notifications |> Map.get("proxyHost", "") |> String.trim()

        if proxy_host === "" do
          Logger.debug("[API] resetting BSM_NOTIFICATIONS_PROXY_HOST")

          System.delete_env("BSM_NOTIFICATIONS_PROXY_HOST")
        else
          Logger.debug("[API] setting BSM_NOTIFICATIONS_PROXY_HOST to #{proxy_host}")

          System.put_env("BSM_NOTIFICATIONS_PROXY_HOST", proxy_host)
        end

        timeout = Map.get(notifications, "timeout", nil)

        if is_number(timeout) and timeout > 0 do
          Logger.debug("[API] setting BSM_NOTIFICATIONS_TIMEOUT to #{timeout}")

          System.put_env("BSM_NOTIFICATIONS_TIMEOUT", to_string(timeout))
        else
          Logger.debug("[API] resetting BSM_NOTIFICATIONS_TIMEOUT")

          System.delete_env("BSM_NOTIFICATIONS_TIMEOUT")
        end

        send_resp(conn, 200, "")
      else
        _ ->
          send_resp(conn, 422, "")
      end
    rescue
      _ ->
        send_resp(conn, 422, "")
    end
  end

  match _ do
    send_resp(conn, 404, "")
  end
end
