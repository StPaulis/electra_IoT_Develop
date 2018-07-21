defmodule BluetoothSensorMonitor.Monitor do
  @moduledoc false
  @module __MODULE__

  require Logger

  alias BluetoothSensorMonitor.{Events, Scanner, Controller, Utils, State}

  import Config

  @behaviour :gen_statem

  @connection_timeout 30_000

  def child_spec(_) do
    %{
      id: @module,
      start: {@module, :start_link, [[]]}
    }
  end

  def start_link(_) do
    :gen_statem.start_link({:local, @module}, @module, nil, [])
  end

  @impl true
  def init(_) do
    Events.subscribe()

    trigger(:init)

    {:ok, :init, %{device: nil}}
  end

  @impl true
  def callback_mode(), do: :state_functions

  ########
  # init #
  ########

  def init(:info, message, data) when message in [:init, :controller_stopped] do
    if message === :init,
      do: Logger.debug("[INIT]"),
      else: Logger.debug("[RESET]")

    System.cmd("sudo", ["killall", "hcitool", "gatttool"], parallelism: false)

    {:next_state, :powering_off_bluetooth, data, [{:state_timeout, 0, :power_off_bluetooth}]}
  end

  def init(type, content, data) do
    handle_event(type, content, :init, data)
  end

  ##########################
  # powering off bluetooth #
  ##########################

  def powering_off_bluetooth(:state_timeout, :power_off_bluetooth, data) do
    Logger.debug("[POWERING OFF BLUETOOTH]")

    System.cmd("sudo", ["hciconfig", "hci0", "down"], parallelism: false)

    {:next_state, :powering_on_bluetooth, data, [{:state_timeout, 1_000, :power_on_bluetooth}]}
  end

  def powering_off_bluetooth(type, content, data) do
    handle_event(type, content, :powering_off_bluetooth, data)
  end

  ##########################
  # powering on bluetooth #
  ##########################

  def powering_on_bluetooth(:state_timeout, :power_on_bluetooth, data) do
    Logger.debug("[POWERING ON BLUETOOTH]")

    System.cmd("sudo", ["hciconfig", "hci0", "up"], parallelism: false)

    {:next_state, :starting_scanner, data, [{:state_timeout, 1_000, :scan}]}
  end

  def powering_on_bluetooth(type, content, data) do
    handle_event(type, content, :powering_on_bluetooth, data)
  end

  ####################
  # starting scanner #
  ####################

  def starting_scanner(:state_timeout, :scan, data) do
    Logger.debug("[STARTING SCANNER]")

    Scanner.start()

    {:next_state, :scanning, data, [{{:timeout, :scanning}, 30_000, :reset}]}
  end

  def starting_scanner(type, content, data) do
    handle_event(type, content, :starting_scanner, data)
  end

  ############
  # scanning #
  ############

  def scanning(:info, {:device_found, id, name}, data) do
    Logger.debug("[DEVICE FOUND] #{id} #{name}")

    Scanner.stop()

    {:next_state, :starting_controller,
     %{
       data
       | device: %{
           id: id,
           name: name,
           attribute_handles: %{},
           device_key: Utils.get_device_key(config(), id, name),
           remaining_attributes: [],
           values: []
         }
     }, [{{:timeout, :scanning}, :infinity, nil}]}
  end

  def scanning({:timeout, :scanning} = timeout, :reset, data) do
    Logger.debug("[SCANNING] #{inspect(timeout)}")

    next_state_reset(data)
  end

  def scanning(type, content, data) do
    handle_event(type, content, :scanning, data)
  end

  #######################
  # starting_controller #
  #######################

  def starting_controller(:info, :scanner_stopped, %{device: %{id: id}} = data) do
    Logger.debug("[STARTING CONTROLLER]")

    Controller.start(id)

    Controller.write("connect\n")

    {:next_state, :connecting, data, @connection_timeout}
  end

  def starting_controller(type, content, data) do
    handle_event(type, content, :starting_controller, data)
  end

  ##############
  # connecting #
  ##############

  def connecting(:info, :device_connected, data) do
    Logger.debug("[DEVICE CONNECTED]")

    trigger(:connected)

    {:next_state, :connected, data}
  end

  def connecting(:timeout, _, data) do
    Logger.debug("[CONNECTING] state timeout")

    next_state_reset(data)
  end

  def connecting(type, content, data) do
    handle_event(type, content, :connecting, data)
  end

  ################
  # reconnecting #
  ################

  def reconnecting(:info, :device_connected, data) do
    Logger.debug("[DEVICE RECONNECTED]")

    {:next_state, :asking_to_power_on_sensors, data,
     [{{:timeout, :asking_to_power_on_sensors}, 0, :ask_to_power_on_sensors}]}
  end

  def reconnecting(:timeout, _, data) do
    Logger.debug("[RECONNECTING] state timeout")

    next_state_reset(data)
  end

  def reconnecting(:info, :device_disconnected, data), do: next_state_reset(data)

  def reconnecting(_type, _content, _data), do: :keep_state_and_data

  #############
  # connected #
  #############

  def connected(:info, :connected, data) do
    Logger.debug("[CONNECTED]")

    Controller.write("char-desc\n")

    {:next_state, :reading_attribute_handles, data,
     [{{:timeout, :reading_attribute_handles}, 30_000, :hard}]}
  end

  def connected(type, content, data) do
    handle_event(type, content, :connected, data)
  end

  #############################
  # reading attribute handles #
  #############################

  def reading_attribute_handles(:info, {:attribute_found, handle, uuid}, data) do
    Logger.debug("[ATTRIBUTE] #{handle} #{uuid}")

    data = put_in(data, [:device, :attribute_handles, uuid], handle)

    {:keep_state, data, [{{:timeout, :reading_attribute_handles}, 1_000, :soft}]}
  end

  def reading_attribute_handles({:timeout, :reading_attribute_handles}, :soft, data) do
    Logger.debug("[ATTRIBUTES FINISHED]")

    data = put_in(data, [:device, :attributes_read], true)

    {:next_state, :asking_to_power_on_sensors, data,
     [{{:timeout, :asking_to_power_on_sensors}, 0, :ask_to_power_on_sensors}]}
  end

  def reading_attribute_handles({:timeout, :reading_attribute_handles}, :hard, data) do
    Logger.debug("[READING ATTRIBUTES] state timeout")

    next_state_reset(data)
  end

  def reading_attribute_handles(type, content, data) do
    handle_event(type, content, :reading_attribute_handles, data)
  end

  ##############################
  # asking to power on sensors #
  ##############################

  def asking_to_power_on_sensors(
        {:timeout, :asking_to_power_on_sensors},
        :ask_to_power_on_sensors,
        data
      ) do
    config = config()

    read_values = config.read_values?.()

    Logger.debug("[ASKING TO POWER ON SENSORS] #{read_values}")

    if read_values do
      trigger(:power_on_sensors)

      {:next_state, :powering_on_sensors, data}
    else
      read_values_interval = config.read_values_interval.()

      {:keep_state, data,
       [{{:timeout, :asking_to_power_on_sensors}, read_values_interval, :ask_to_power_on_sensors}]}
    end
  end

  def asking_to_power_on_sensors(type, content, data) do
    handle_event(type, content, :asking_to_power_on_sensors, data)
  end

  #######################
  # powering on sensors #
  #######################

  def powering_on_sensors(
        :info,
        :power_on_sensors,
        %{device: %{device_key: device_key, attribute_handles: attribute_handles}} = data
      ) do
    Logger.debug("[POWERING ON SENSORS]")

    attribute_configs = config().devices[device_key].attributes

    remaining_attributes =
      attribute_configs
      |> Enum.reduce([], fn {name, attribute_config}, remaining_attributes ->
        attribute_switch_handle = attribute_handles[attribute_config.switch.uuid]
        attribute_data_handle = attribute_handles[attribute_config.data.uuid]

        Controller.write(
          "char-write-req #{attribute_switch_handle} #{attribute_config.switch.on}\n"
        )

        [{name, attribute_data_handle} | remaining_attributes]
      end)
      |> Enum.reverse()

    data = put_in(data, [:device, :remaining_attributes], remaining_attributes)

    {:next_state, :waiting_for_sensors, data, [{:state_timeout, 1_000, :read_values}]}
  end

  def powering_on_sensors(type, content, data) do
    handle_event(type, content, :powering_on_sensors, data)
  end

  #######################
  # waiting for sensors #
  #######################

  def waiting_for_sensors(:state_timeout, :read_values, data) do
    Logger.debug("[WAITING FOR SENSORS] state timeout")

    trigger(:read_values)

    {:next_state, :reading_values, data}
  end

  def waiting_for_sensors(type, content, data) do
    handle_event(type, content, :waiting_for_sensors, data)
  end

  ##################
  # reading values #
  ##################

  def reading_values(
        :info,
        :read_values,
        %{device: %{device_key: device_key, remaining_attributes: [], values: values}} = data
      ) do
    Logger.debug("[DONE READING VALUES]")

    device_config = config().devices[device_key]

    values
    |> Enum.map(fn {name, value} ->
      {name, device_config.attributes[name].data.parser.(value)}
    end)
    |> device_config.formatter.()
    |> State.set()

    trigger(:power_off_sensors)

    {:next_state, :powering_off_sensors, data}
  end

  def reading_values(
        :info,
        :read_values,
        %{device: %{remaining_attributes: [{name, attribute_data_handle} | _rest]}} = data
      ) do
    Logger.debug("[READING VALUE] #{name} #{attribute_data_handle}")

    Controller.write("char-read-hnd #{attribute_data_handle}\n")

    {:keep_state, data}
  end

  def reading_values(
        :info,
        {:value, value},
        %{
          device:
            %{remaining_attributes: [{name, attribute_data_handle} | rest], values: values} =
              device
        } = data
      ) do
    Logger.debug("[READ VALUE] #{name} #{attribute_data_handle} #{inspect(value)}")

    data =
      Map.put(
        data,
        :device,
        Map.merge(device, %{
          remaining_attributes: rest,
          values: Keyword.put(values, name, value)
        })
      )

    trigger(:read_values)

    {:keep_state, data}
  end

  def reading_values(type, content, data) do
    handle_event(type, content, :reading_values, data)
  end

  ########################
  # powering off sensors #
  ########################

  def powering_off_sensors(
        :info,
        :power_off_sensors,
        %{device: %{device_key: device_key, attribute_handles: attribute_handles}} = data
      ) do
    Logger.debug("[POWERING OFF SENSORS]")

    attribute_configs = config().devices[device_key].attributes

    Enum.each(attribute_configs, fn {_name, attribute_config} ->
      attribute_switch_handle = attribute_handles[attribute_config.switch.uuid]

      Controller.write(
        "char-write-req #{attribute_switch_handle} #{attribute_config.switch.off}\n"
      )
    end)

    {:next_state, :looping, data, [{:state_timeout, 0, :ask_to_power_on_sensors}]}
  end

  def powering_off_sensors(type, content, data) do
    handle_event(type, content, :powering_off_sensors, data)
  end

  ###########
  # looping #
  ###########

  def looping(:state_timeout, :ask_to_power_on_sensors, data) do
    read_values_interval = config().read_values_interval.()

    {:next_state, :asking_to_power_on_sensors, data,
     [{{:timeout, :asking_to_power_on_sensors}, read_values_interval, :ask_to_power_on_sensors}]}
  end

  def looping(type, content, data) do
    handle_event(type, content, :looping, data)
  end

  #########################
  # fallback handle_event #
  #########################

  @impl true
  def handle_event(_, :device_disconnected, _, data) do
    Controller.write("connect\n")

    {:next_state, :reconnecting, data, @connection_timeout}
  end

  @impl true
  def handle_event(_, _, _, _), do: :keep_state_and_data

  #####################
  # private functions #
  #####################

  defp trigger(what), do: send(self(), what)

  defp next_state_reset(data) do
    Scanner.stop()

    Controller.write("disconnect\n")

    Controller.stop()

    data = %{data | device: nil}

    {:next_state, :init, data}
  end
end
