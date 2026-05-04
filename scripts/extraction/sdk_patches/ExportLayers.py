import csv
import unreal

from string import digits

import sys

class LayerExporter(object):
    FactionTracker = {}
    LegendTracker = {}
    ChangesTracker = {}

    def __init__(self, _export_path="", _previous_layer_filepath="", _previous_vehicle_filepath="", _previous_layer_list=None, _asset_registry=None, _FactionTable=None):
        self.asset_registry = unreal.AssetRegistryHelpers.get_asset_registry()

        # Hard reference to FactionTable, as there is no code path leading to it from the faction setups or layer setups. this is to get the proper display name for the faction
        # ../Squad/Content/Settings/Factions/FactionTable.uasset
        self.FactionTable = unreal.EditorAssetLibrary.find_asset_data('/Game/Settings/Factions/FactionTable.FactionTable').get_asset()

        self.previous_layer_list = _previous_layer_list
        self.previous_layer_filepath = _previous_layer_filepath
        self.previous_vehicle_filepath = _previous_vehicle_filepath
        self.export_path = _export_path

        self.FactionTracker.clear()
        self.LegendTracker.clear()
        self.ChangesTracker.clear()

    def GetTeamName(self, FactionID):
        row_names = unreal.DataTableFunctionLibrary.get_data_table_row_names(self.FactionTable)
        columns_name = unreal.DataTableFunctionLibrary.get_data_table_column_as_string(self.FactionTable, "DisplayName")

        #TODO: hack because some of our FactionSetup are using "US" as a faction ID instead of "USA", and US doesn't exist in the FactionTable.
        if FactionID == "US":
            FactionID = "USA"

        row_index = row_names.index(FactionID)
        ColumnValues = columns_name[row_index].split(',')
        name = ColumnValues[len(ColumnValues) -1].replace("\"", "")
        name = name.replace('\\', '')
    
        return name[:-1]

    def GetUnitName(self, FactionAsset):
        if FactionAsset is None:
            return "INVALID";
        row_names = unreal.DataTableFunctionLibrary.get_data_table_row_names(FactionAsset.get_editor_property("Data").data_table)
        columns_name = unreal.DataTableFunctionLibrary.get_data_table_column_as_string(FactionAsset.get_editor_property("Data").data_table, "DisplayName")

        row_index = row_names.index(FactionAsset.get_editor_property("Data").row_name);
        ColumnValues = columns_name[row_index].split(',')
        name = ColumnValues[len(ColumnValues) -1].replace("\"", "")
        name = name.replace('\\', '')

        return name[:-1]

    def ExportVehicleForTeam(self, in_writer, Layer, Teams):
        team_index = 0
        for Team in Teams:
            FactionSetup = Team.get_editor_property("SpecificFactionSetup")
            if FactionSetup is None:
                return 0;
            Vehicles = FactionSetup.get_editor_property("Vehicles")
            Faction_ID =  FactionSetup.get_editor_property("FactionId")
        
            team_name = self.GetTeamName(Faction_ID)
            layer_name = ""
            if team_index == 0:
                layer_name = Layer.get_name()

            team_index += 1
    
            index = 0
            for Vehicle in Vehicles:
                VehicleSettings = Vehicle.get_editor_property("Setting")
                VehicleRespawnData = Vehicle.get_editor_property("Delay")
                VehicleCountData = Vehicle.get_editor_property("LimitedCount")

                VehicleName = ""
                VehicleCount = 0
                InitialDelay = 0
                RespawnTime = 0

                if VehicleSettings != None:
                    VehicleDataTable = VehicleSettings.get_editor_property("Data").get_editor_property("DataTable")
                    VehicleRowName = str(VehicleSettings.get_editor_property("Data").get_editor_property("RowName"))
                    row_names = unreal.DataTableFunctionLibrary.get_data_table_row_names(VehicleDataTable)
                    columns_name = unreal.DataTableFunctionLibrary.get_data_table_column_as_string(VehicleDataTable, "DisplayName")
                    if VehicleRowName not in row_names :
                        print("Missing info for Vehicle: " + VehicleRowName);
                        continue;
                    row_index = row_names.index(VehicleRowName)
                    ColumnValues = columns_name[row_index].split(',')
                    VehicleName = ColumnValues[len(ColumnValues) -1].replace("\"", "")[:-1]
            
                if VehicleRespawnData != None:            
                    InitialDelay = unreal.MathLibrary.get_total_minutes(VehicleRespawnData.get_editor_property("InitialDelay"))
                    RespawnTime = unreal.MathLibrary.get_total_minutes(VehicleRespawnData.get_editor_property("Delay"))
            
                if VehicleCountData != None:
                    VehicleCount = VehicleCountData.get_editor_property("BaseAvailability")
            
                if index != 0:
                    team_name = ""
                    layer_name = ""
            
                # print([team_name, str(VehicleName), VehicleCount, InitialDelay, RespawnTime])
                in_writer.writerow(["", layer_name, team_name, "", VehicleName, VehicleCount, InitialDelay, RespawnTime])
                index+=1
                
        return 1;

    def ExportVehicleForFaction(self, in_writer, Layer, Faction, WithLayerName):
        FactionSetup = Faction
        if FactionSetup is None:
            return 0;
        Vehicles = FactionSetup.get_editor_property("Vehicles")
        Faction_ID =  FactionSetup.get_editor_property("FactionId")
        FactionAssetName = FactionSetup.get_path_name().split('.')[1]
        
        team_name = str(Faction_ID) + " " + self.GetUnitName(FactionSetup)
        layer_name = ""
        if WithLayerName == 1:
            layer_name = str(Layer.get_editor_property("Data").row_name)
    
        index = 0
        for Vehicle in Vehicles:
            VehicleSettings = Vehicle.get_editor_property("Setting")
            VehicleRespawnData = Vehicle.get_editor_property("Delay")
            VehicleCountData = Vehicle.get_editor_property("LimitedCount")

            VehicleName = ""
            VehicleCount = 0
            InitialDelay = 0
            RespawnTime = 0

            if VehicleSettings != None:
                VehicleDataTable = VehicleSettings.get_editor_property("Data").get_editor_property("DataTable")
                VehicleRowName = str(VehicleSettings.get_editor_property("Data").get_editor_property("RowName"))
                row_names = unreal.DataTableFunctionLibrary.get_data_table_row_names(VehicleDataTable)
                columns_name = unreal.DataTableFunctionLibrary.get_data_table_column_as_string(VehicleDataTable, "DisplayName")
                if VehicleRowName not in row_names :
                    print("Missing info for Vehicle: " + VehicleRowName);
                    continue;
                row_index = row_names.index(VehicleRowName)
                ColumnValues = columns_name[row_index].split(',')
                VehicleName = ColumnValues[len(ColumnValues) -1].replace("\"", "")[:-1]
            
            if VehicleRespawnData != None:            
                InitialDelay = unreal.MathLibrary.get_total_minutes(VehicleRespawnData.get_editor_property("InitialDelay"))
                RespawnTime = unreal.MathLibrary.get_total_minutes(VehicleRespawnData.get_editor_property("Delay"))
            
            if VehicleCountData != None:
                VehicleCount = VehicleCountData.get_editor_property("BaseAvailability")
            
            if index != 0:
                team_name = ""
                layer_name = ""
                FactionAssetName = ""
            
            # print([team_name, str(VehicleName), VehicleCount, InitialDelay, RespawnTime])
            in_writer.writerow(["", layer_name, team_name, FactionAssetName, "", VehicleName, VehicleCount, InitialDelay, RespawnTime])
            index+=1
                
        return 1;

    def ExportDeployablesForFaction(self, in_writer, Layer, Faction, WithLayerName):
        FactionSetup = Faction
        if FactionSetup is None:
            return 0;
        Deployables = FactionSetup.get_editor_property("Deployables")
        Faction_ID =  FactionSetup.get_editor_property("FactionId")
        FactionAssetName = FactionSetup.get_path_name().split('.')[1]
        
        team_name = str(Faction_ID) + " " + self.GetUnitName(FactionSetup)
        layer_name = ""
        if WithLayerName == 1:
            layer_name = str(Layer.get_editor_property("Data").row_name)
    
        index = 0
        for Deploy in Deployables:
            DeploySettings = Deploy.get_editor_property("Setting")

            DeployName = ""

            if DeploySettings != None:
                DeployDataTable = DeploySettings.get_editor_property("Data").get_editor_property("DataTable")
                DeployRowName = str(DeploySettings.get_editor_property("Data").get_editor_property("RowName"))
                row_names = unreal.DataTableFunctionLibrary.get_data_table_row_names(DeployDataTable)
                columns_name = unreal.DataTableFunctionLibrary.get_data_table_column_as_string(DeployDataTable, "DisplayName")
                if DeployRowName not in row_names :
                    print("Missing info for Deployable: " + DeployRowName);
                    continue;
                row_index = row_names.index(DeployRowName)
                ColumnValues = columns_name[row_index].split(',')
                DeployName = ColumnValues[len(ColumnValues) -1].replace("\"", "")[:-1]
            
            if index != 0:
                team_name = ""
                layer_name = ""
                FactionAssetName = ""
            
            # print([team_name, str(VehicleName), VehicleCount, InitialDelay, RespawnTime])
            in_writer.writerow(["", layer_name, team_name, FactionAssetName, "", DeployName])
            index+=1
                
        return 1;
    
    def GetLightingName(self, Layer):
        # HACK: bit of a work around, since python resolves soft object pointers and loads into memory,so as a hack I rely on our folder structure to get the package name to get the dependencies without loading the map asset    
        package_name = Layer.get_path_name()
        if "Gameplay_LayerData" in package_name:
            # HACK: another disgusting hack because of a spelling mistake
            # TODO: use Regex to replace it, so we can address the edge case of a spelling mistake.

            world = Layer.get_editor_property("Worlds")
            package_name = Layer.get_path_name().replace("Gameplay_LayerData", "Gameplay_Layers").split('.')[0]
        else:
            package_name = Layer.get_path_name().replace("Gameplay_Layer_Data", "Gameplay_Layers").split('.')[0]

        if Layer.get_editor_property("PersistentLightingType").row_name is not None:
            return Layer.get_editor_property("PersistentLightingType").row_name;
        
        dependency_options = unreal.AssetRegistryDependencyOptions(True, True, True, True, True)
        dependencies = self.asset_registry.get_dependencies(package_name, dependency_options)
        if dependencies != None:
            for dep in dependencies:
                if dep != None:
                    dep_name_str = str(dep)
                    if "LL" in dep_name_str:
                        split_dep_name = dep_name_str.split('_')
                        remove_digits = str.maketrans('', '', digits)
                        return split_dep_name[len(split_dep_name)-1].translate(remove_digits)

        return ""

    def GetNumberOfVehicles(self, FactionSetup, Type = ""):
        Vehicles = FactionSetup.get_editor_property("Vehicles")
        amount = 0
        InitialDelay = 0

        for Vehicle in Vehicles:
            if Vehicle != None:
                VehicleSetting = Vehicle.get_editor_property("Setting")
                    
                if VehicleSetting.get_editor_property("VehicleType").name == Type:
                    amount += 1
                    DelaySettings = Vehicle.get_editor_property("Delay")
                    if DelaySettings != None:
                        InitialDelay = unreal.MathLibrary.get_total_minutes(DelaySettings.get_editor_property("InitialDelay"))
            
        Result = ""
        if amount > 0:
            Result = str(amount)
            if InitialDelay > 0:
                Result += " @ " + str(InitialDelay).split('.')[0] + "min"

        return Result

    def Contains(self, ID, Name):
        Name = Name.replace(' ', '')
        index = int(0)
        
        column_names_list = self.previous_layer_list[0].split(',')
        name_index = column_names_list.index("Layer Name")
        id_index = column_names_list.index("ID")
        
        for L in self.previous_layer_list:
            split_L = L.split(',')
            if len(split_L) > 1:
                current_level_name = split_L[name_index].replace(' ', '')
                if current_level_name == Name:
                    return split_L
            index += 1

        return -1
    
    def IncrementTracker(self, Tracker, Key):
        try:
            Tracker[Key] += 1
        except KeyError:
            Tracker[Key] = 1

        return Tracker[Key]

    def ExportToCSV(self):
        # Get the list of layers.
        Layerslist = unreal.SQChunkSettings.get_default_object().get_editor_property("LayersToCook")

        number_of_assets = len(Layerslist)
        print("Number of assets: " + str(number_of_assets))

        if self.export_path == "":
            self.export_path = unreal.Paths.project_saved_dir()

        save_path = self.export_path + "/SquadLayers.csv"
        save_path_vehicles = self.export_path + "/SquadVehicleLayers.csv"
        save_path_deployables = self.export_path + "/SquadDeployables.csv"

        print("Base Path: " + self.export_path)
        print("Layer Path: " + save_path)
        print("Vehicles Path: " + save_path_vehicles)
        print("Deployables Path: " + save_path_deployables)

        with unreal.ScopedSlowTask(len(Layerslist), "Converting to CSV") as slow_task:
            #Create CSV files
            VehiclesFile = open(save_path_vehicles, 'w', newline='')
            vehicle_writer = csv.writer(VehiclesFile)
            vehicle_writer.writerow(["", "Layer Name","Team Name", "Team ID", "Icon","Vehicle Name", "Vehicle Count", "Initial Delay", "Respawn Time"])

            #Deployables CSV files
            DeployablesFile = open(save_path_deployables, 'w', newline='')
            deployables_writer = csv.writer(DeployablesFile)
            deployables_writer.writerow(["", "Layer Name", "Team Name", "Team ID", "", "Deployable Name"])

            # try to open previous CSV files from input paths
            if self.previous_layer_filepath != "":
                previous_layer_file = open(self.previous_layer_filepath, 'r')
                self.previous_layer_list = list(previous_layer_file)

            if self.previous_vehicle_filepath != "":
                previous_vehicle_file = open(self.previous_vehicle_filepath, 'r')
                previous_vehicle_reader = csv.reader(previous_vehicle_file)

            with open(save_path, 'w', newline='') as file:
                layer_writer = csv.writer(file)
                layer_writer.writerow(["","Level","ID", "Layer Name", "CP Type","Lighting", "Tickets", "CO", "", "Faction", "Unit", "Asset Name", "Usable", "Tanks", "Heli", "","Changes", "Notes"])

                slow_task.make_dialog(True)
                # loop through every found asset and write the data to csv file.
                CurrentLayerName = ""
                LevelName = ""

                asset_id = 1
                for asset in Layerslist:
                    if slow_task.should_cancel():
                        break

                    if asset is None:
                        continue;

                    # Lighting ------------------------------------------------
                    LightingName = self.GetLightingName(asset)

                    # Layer ---------------------------------------------------
                    name = str(asset.get_editor_property("Data").row_name)
                    if name.split('_')[0] != CurrentLayerName:
                        if asset_id != 1:
                            layer_writer.writerow([])
                        CurrentLayerName = name.split('_')[0]
                        LevelName = asset.get_editor_property("LevelId")
                    else:
                        LevelName = ""
                
                    cp_type = asset.get_editor_property("Gamemode").row_name
                    
                    self.IncrementTracker(self.LegendTracker, str(cp_type))

                    co = ""
                    if asset.get_editor_property("GameFlags").get_editor_property("CommanderDisabled"):
                        co = "No"
                    else:
                        co = "Yes"

                    Teams = asset.get_editor_property("TeamConfigs")
                    #self.ExportVehicleForTeam(vehicle_writer, asset, Teams)
                    #vehicle_writer.writerow([])

                    # Skip layers that ship without a populated TeamConfigs array
                    # (e.g. some Coop / Fireteam templates in 10.4)
                    if len(Teams) < 2:
                        unreal.log_warning("Skipping layer with %d TeamConfigs: %s" % (len(Teams), name))
                        continue

                    # TEAM 1 ---------------------------------------------------
                    team1_factionSetup = Teams[0].get_editor_property("SpecificFactionSetup")
                    if team1_factionSetup is None:
                        team1_factionID = "INVALID"
                        team1_name = "INVALID"
                        team1_asset_name = "INVALID"
                    else:
                        team1_factionID = team1_factionSetup.get_editor_property("FactionId")
                        team1_name = self.GetTeamName(team1_factionID)
                        team1_tickets = Teams[0].get_editor_property("Tickets")
                        team1_tanks = self.GetNumberOfVehicles(team1_factionSetup, "MBT")
                        team1_Heli = self.GetNumberOfVehicles(team1_factionSetup, "UH")
                        team1_asset_name = team1_factionSetup.get_name();

                    # TEAM 2 ---------------------------------------------------
                    team2_factionSetup = Teams[1].get_editor_property("SpecificFactionSetup")
                    if team2_factionSetup is None:
                        team2_factionID = "INVALID"
                        team2_name = "INVALID"
                        team2_asset_name = "INVALID"
                    else:
                        team2_factionID = team2_factionSetup.get_editor_property("FactionId")
                        team2_name = self.GetTeamName(team2_factionID)
                        team2_tickets = Teams[1].get_editor_property("Tickets")
                        team2_tanks = self.GetNumberOfVehicles(team2_factionSetup, "MBT")
                        team2_Heli = self.GetNumberOfVehicles(team2_factionSetup, "UH")
                        team2_asset_name = team2_factionSetup.get_name();

                    # Update Faction tracker
                    self.IncrementTracker(self.FactionTracker, str(team1_factionID))
                    self.IncrementTracker(self.FactionTracker,  str(team2_factionID))

                    # Check for layer changes -----------------------------------
                    Changes = ""
                    if self.previous_layer_list != None:
                        Row = self.Contains(asset_id, name)
                        
                        # Figure out which indexes to use when trying to access information from the csv data 
                        # This is kept in a while loop for visibility purposes only
                        column_names_list = self.previous_layer_list[0].split(',')
                        
                        layer_name_index = column_names_list.index("Layer Name")
                        id_index = column_names_list.index("ID")
                        lighting_index = column_names_list.index("Lighting")
                        
                        team1_index = column_names_list.index("Team1")
                        team2_index = column_names_list.index("Team2")
                        
                        # We are assuming that tickets for team 1 and team 2 are in the column right after it, same with tanks and heli
                        # This hard-coding is necessary because we have two columns with the same name for each team (Tickets, Tanks, Heli)
                        # And there is no way to differentiate between them just by name alone
                        team1_tickets_index = team1_index + 1 
                        team2_tickets_index = team2_index + 1
                        
                        team1_tanks_index = team1_index + 2
                        team2_tanks_index = team2_index + 2 
                        
                        team1_heli_index = team1_index + 3
                        team2_heli_index = team2_index + 3 
                        
                        if Row != -1:
                            if Row[layer_name_index] != name and Row[id_index] == str(asset_id):
                                Changes += " Name Change"
                                self.IncrementTracker(self.ChangesTracker, "Name Changes")
                            if Row[team1_index] != team1_name or Row[team2_index] != team2_name:
                                Changes += " Faction Change"
                                self.IncrementTracker(self.ChangesTracker,"Faction Changes")
                            if Row[team1_tickets_index] != str(team1_tickets) or Row[team2_tickets_index] != str(team2_tickets):
                                Changes += " Tickets Change"
                                self.IncrementTracker(self.ChangesTracker,"Tickets Changes")
                            if Row[team1_tanks_index] != str(team1_tanks) or Row[team1_heli_index] != str(team1_Heli) or Row[team2_tanks_index] != team2_tanks or Row[team2_heli_index] != team2_Heli:
                                Changes += " Vehicles Change"
                                self.IncrementTracker(self.ChangesTracker,"Vehicle Changes")
                            if Row[lighting_index] != LightingName:
                                Changes += " Lighting Changes"
                                self.IncrementTracker(self.ChangesTracker,"Lighting Changes")
                        else:
                            print("ROW " + name + " NOT FOUND!")
                            Changes += "NEW!"
                            self.IncrementTracker(self.ChangesTracker,"NewMapLayer")
                        
                    Notes = ""

                    # Default factions
                    UnitName = self.GetUnitName(team1_factionSetup);
                    layer_writer.writerow(["", LevelName, asset_id, name, cp_type, LightingName, str(team1_tickets) + " v " + str(team2_tickets), co, "", team1_factionID, str(team1_factionID) + " " + UnitName, team1_asset_name, "Team1 Default", team1_tanks, team1_Heli, "", Changes, Notes])
                    self.ExportVehicleForFaction(vehicle_writer, asset, team1_factionSetup, 1);
                    self.ExportDeployablesForFaction(deployables_writer, asset, team1_factionSetup, 1);
                    
                    UnitName = self.GetUnitName(team2_factionSetup);
                    layer_writer.writerow(["", "", "", "", "", "", "", "", "", team2_factionID, str(team2_factionID) + " " + UnitName, team2_asset_name, "Team2 Default", team2_tanks, team2_Heli, "", Changes, Notes])
                    self.ExportVehicleForFaction(vehicle_writer, asset, team2_factionSetup, 0);
                    self.ExportDeployablesForFaction(deployables_writer, asset, team2_factionSetup, 0);
                    
                    SeparatedTeams = asset.get_editor_property("bSeparatedFactionsList");
                    Usable = "Team1, Team2";
                    if SeparatedTeams == 1:
                        Usable = "Team1";
                        
                    for FactionID in asset.get_editor_property("FactionsList").keys():
                        FactionAsset = asset.get_editor_property("FactionsList").get(FactionID).get_editor_property("Faction");
                        if FactionAsset is None:
                            layer_writer.writerow(["", "", "", "", "", "", "", "", "", FactionID, str(FactionID) + " " + UnitName, "INVALID" ,Usable, tanks_num, heli_numm, "", Changes, Notes])
                            continue;
                            
                        UnitName = self.GetUnitName(FactionAsset);
                        tanks_num = self.GetNumberOfVehicles(FactionAsset, "MBT")
                        heli_numm = self.GetNumberOfVehicles(FactionAsset, "UH")

                        layer_writer.writerow(["", "", "", "", "", "", "", "", "", FactionID, str(FactionID) + " " + UnitName, FactionAsset.get_name(), Usable, tanks_num, heli_numm, "", Changes, Notes])
                        self.ExportVehicleForFaction(vehicle_writer, asset, FactionAsset, 0);
                        self.ExportDeployablesForFaction(deployables_writer, asset, FactionAsset, 0);

                        for TypeFaction in asset.get_editor_property("FactionsList").get(FactionID).get_editor_property("Types").keys():
                            FactionAsset = asset.get_editor_property("FactionsList").get(FactionID).get_editor_property("Types").get(TypeFaction);
                            if FactionAsset is None:
                                layer_writer.writerow(["", "", "", "", "", "", "", "", "", str(FactionID) + "+" + str(TypeFaction), str(FactionID) + " " + UnitName, "INVALID", Usable, tanks_num, heli_numm, "", Changes, Notes])
                                continue;
                                
                            UnitName = self.GetUnitName(FactionAsset);
                            layer_writer.writerow(["", "", "", "", "", "", "", "", "", str(FactionID) + "+" + str(TypeFaction), str(FactionID) + " " + UnitName, FactionAsset.get_name(), Usable, tanks_num, heli_numm, "", Changes, Notes])
                            self.ExportVehicleForFaction(vehicle_writer, asset, FactionAsset, 0);
                            self.ExportDeployablesForFaction(deployables_writer, asset, FactionAsset, 0);

                    if SeparatedTeams == 1:
                        Usable = "Team2";
                        for FactionID in asset.get_editor_property("FactionsListTeamTwo").keys():
                            FactionAsset = asset.get_editor_property("FactionsListTeamTwo").get(FactionID).get_editor_property("Faction");
                            if FactionAsset is None:
                                layer_writer.writerow(["", "", "", "", "", "", "", "", "", FactionID, str(FactionID) + " " + UnitName, "INVALID", Usable, tanks_num, heli_numm, "", Changes, Notes])
                                continue;
                                
                            UnitName = self.GetUnitName(FactionAsset);
                            anks_num = self.GetNumberOfVehicles(FactionAsset, "MBT")
                            heli_numm = self.GetNumberOfVehicles(FactionAsset, "UH")
                        
                            layer_writer.writerow(["", "", "", "", "", "", "", "", "", FactionID, str(FactionID) + " " + UnitName, FactionAsset.get_name(), Usable, tanks_num, heli_numm, "", Changes, Notes])
                            self.ExportVehicleForFaction(vehicle_writer, asset, FactionAsset, 0);
                            self.ExportDeployablesForFaction(deployables_writer, asset, FactionAsset, 0);

                            for TypeFaction in asset.get_editor_property("FactionsListTeamTwo").get(FactionID).get_editor_property("Types").keys():
                                FactionAsset = asset.get_editor_property("FactionsListTeamTwo").get(FactionID).get_editor_property("Types").get(TypeFaction);
                                if FactionAsset is None:
                                    layer_writer.writerow(["", "", "", "", "", "", "", "", "", str(FactionID) + "+" + str(TypeFaction), str(FactionID) + " " + UnitName, "INVALID", Usable, tanks_num, heli_numm, "", Changes, Notes])
                                    continue;
                                    
                                UnitName = self.GetUnitName(FactionAsset);
                                layer_writer.writerow(["", "", "", "", "", "", "", "", "", str(FactionID) + "+" + str(TypeFaction), str(FactionID) + " " + UnitName, FactionAsset.get_name(), Usable, tanks_num, heli_numm, "", Changes, Notes])
                                self.ExportVehicleForFaction(vehicle_writer, asset, FactionAsset, 0);
                                self.ExportDeployablesForFaction(deployables_writer, asset, FactionAsset, 0);
                            
                    asset_id += 1
                    slow_task.enter_progress_frame(1)
                
            VehiclesFile.close()
            DeployablesFile.close()
            file.close()

        return self.export_path

# This allows us to run the script Indepedantly.
if __name__ == "__main__":
    input_size = len(sys.argv)

    export_path=""
    previous_layer_filepath=""
    previous_vehicle_filepath=""

    if input_size > 1:
        export_path = sys.argv[1]

    if input_size > 2:
        previous_layer_filepath = sys.argv[2]

    if input_size > 3:
        previous_vehicle_filepath = sys.argv[3]

    LExporter = LayerExporter(export_path, previous_layer_filepath, previous_vehicle_filepath)
    LExporter.ExportToCSV()