defmodule BluetoothSensorMonitor.MixProject do
  use Mix.Project

  def project do
    [
      app: :bluetooth_sensor_monitor,
      version: "0.1.0",
      elixir: "~> 1.6",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      extra_applications: [:logger],
      mod: {BluetoothSensorMonitor.Application, []}
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      {:cowboy, "~> 1.1"},
      {:distillery, "~> 1.5"},
      {:tesla, "~> 1.0"},
      {:plug, "~> 1.5"},
      {:poison, github: "StoiximanServices/poison", override: true}
    ]
  end
end
