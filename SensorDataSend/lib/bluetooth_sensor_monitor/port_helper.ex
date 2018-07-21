defmodule BluetoothSensorMonitor.PortHelper do
  @moduledoc false
  @module __MODULE__

  require Logger

  use GenServer

  def start_link(opts) do
    name = opts[:name] || raise ArgumentError, "No executable provided"
    args = opts[:args] || []
    events_config = opts[:events_config]
    process_opts = opts[:process_opts] || []

    GenServer.start_link(
      @module,
      %{executable: {name, args}, events_config: events_config, buffer: ""},
      process_opts
    )
  end

  @impl true
  def init(state) do
    state = state || %{}

    Process.flag(:trap_exit, true)

    send(self(), :spawn)

    state =
      Map.merge(state, %{
        closing: false,
        port: nil
      })

    {:ok, state}
  end

  def write(pid, data) do
    GenServer.call(pid, {:write, data})
  catch
    :exit, error -> error
  end

  def close(pid) do
    GenServer.call(pid, :close)
  catch
    :exit, error -> error
  end

  @impl true
  def handle_call({:write, _data}, _from, %{closing: true} = state) do
    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:write, data}, _from, %{port: port, closing: false} = state) do
    Port.command(port, data)

    {:reply, :ok, state}
  end

  @impl true
  def handle_call(:close, _from, %{port: nil, executable: {name, args}} = state) do
    Logger.error("[ALREADY CLOSED] #{name}(#{inspect(args)})")

    {:reply, :ok, state}
  end

  @impl true
  def handle_call(:close, _from, %{port: port} = state) do
    os_pid = port |> Port.info() |> Keyword.get(:os_pid)

    Port.close(port)

    System.cmd("sudo", ["kill", "-INT", to_string(os_pid)])

    state = %{state | closing: true}

    {:reply, :ok, state}
  end

  @impl true
  def handle_info(:spawn, %{executable: {name, args}} = state) do
    exe = System.find_executable(name)

    port =
      Port.open({:spawn_executable, exe}, [
        :binary,
        :use_stdio,
        :stderr_to_stdout,
        line: 1024,
        args: args
      ])

    info = Port.info(port)

    Logger.debug("[SPAWNED] #{name}(#{inspect(args)}) #{inspect(info)}")

    state = %{state | port: port}

    {:noreply, state}
  end

  @impl true
  def handle_info({for_port, :connected}, %{port: port, executable: {name, args}} = state)
      when for_port === port do
    Logger.debug("[CONNECTED] #{name}(#{inspect(args)})")

    {:noreply, state}
  end

  @impl true
  def handle_info({for_port, :closed}, %{port: port, executable: {name, args}} = state)
      when for_port === port do
    Logger.debug("[CLOSED] #{name}(#{inspect(args)})")

    {:noreply, state}
  end

  @impl true
  def handle_info({for_port, {:data, {:eol, data}}}, %{port: port, buffer: buffer} = state)
      when for_port === port do
    data = buffer <> data

    Logger.debug("[DATA] #{data}")

    publish_event_data(data, state)

    state = %{state | buffer: ""}

    {:noreply, state}
  end

  @impl true
  def handle_info({for_port, {:data, {:noeol, data}}}, %{port: port, buffer: buffer} = state)
      when for_port === port do
    # Logger.debug("[PARTIAL DATA] #{data}")

    state = %{state | buffer: buffer <> data}

    {:noreply, state}
  end

  @impl true
  def handle_info({:EXIT, for_port, reason}, %{port: port, closing: closing} = state)
      when for_port === port do
    log_exit(reason, state)

    if !closing do
      state = %{state | port: nil}

      Process.send_after(@module, :spawn, 1000)

      {:noreply, state}
    else
      state = %{state | port: nil}

      {:stop, :normal, state}
    end
  end

  @impl true
  def handle_info(msg, %{executable: {name, args}} = state) do
    Logger.error("[UNHANDLED] #{name}(#{inspect(args)}): #{inspect(msg)}")

    {:noreply, state}
  end

  defp log_exit(:normal, %{executable: {name, args}, closing: closing}) do
    Logger.debug("[EXIT] #{name}(#{inspect(args)}) :normal (will respawn = #{!closing})")
  end

  defp log_exit(reason, %{executable: {name, args}, closing: closing}) do
    Logger.error(
      "[EXIT] #{name}(#{inspect(args)}) #{inspect(reason)} (will respawn = #{!closing})"
    )
  end

  defp publish_event_data(_event_data, %{events_config: nil}), do: nil

  defp publish_event_data(event_data, %{events_config: {events_registry, topic}}) do
    events_registry.publish({topic, event_data})
  end
end
