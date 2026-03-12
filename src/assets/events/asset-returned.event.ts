export class AssetReturnedEvent {
  constructor(
    public readonly assetId: string,
    public readonly assetName: string,
    public readonly performedBy: string,
    public readonly employeeIds: string[],
    public readonly employeeNames: string[],
    public readonly timestamp: Date = new Date(),
  ) {}
}
