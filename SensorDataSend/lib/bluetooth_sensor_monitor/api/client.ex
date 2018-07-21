defmodule BluetoothSensorMonitor.API.Client do
  @moduledoc false

  use Tesla

  @default_request_timeout 5_000

  def post_data(data, url) do
    data = Poison.encode!(data, format_keys: :camel_case)

    post(build_client(), url, data)
  catch
    :exit, error -> {data, error}
  end

  defp build_client() do
    headers = [{"Content-Type", "application/json"}]

    headers =
      case System.get_env("BSM_NOTIFICATIONS_PROXY_HOST") do
        nil -> headers
        proxy_host -> [{"Host", proxy_host} | headers]
      end

    Tesla.build_client([
      {Tesla.Middleware.Headers, headers},
      {Tesla.Middleware.Timeout, timeout: get_timeout()}
    ])
  end

  defp get_timeout() do
    (System.get_env("BSM_NOTIFICATIONS_TIMEOUT") || to_string(@default_request_timeout))
    |> Integer.parse()
    |> elem(0)
  end
end
